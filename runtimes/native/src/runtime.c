#include "runtime.h"
#include <stdbool.h>

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "apu.h"
#include "framebuffer.h"
#include "util.h"
#include "wasm.h"
#include "window.h"

#define WIDTH 160
#define HEIGHT 160

#define SYSTEM_PRESERVE_FRAMEBUFFER 1



typedef struct {
    Memory memory;
    w4_Disk disk;
    bool firstFrame;
} SerializedState;

static w4_ExitInfo exitInfo = {0};
static w4_InputEvent inputEvents[1024];
static int inputEventCount = 0;
static bool recordingInput = false;
static uint32_t frameNumber = 0;
w4_GamepadRecorder gamepadRecorder = {0};

Memory* memory;
w4_Disk* disk;
static bool firstFrame;

static void panic(const char *msg)
{
    /* REVISIT: it's cleaner to raise a wasm trap */
    fprintf(stderr, "fatal error in host function: %s\n", msg);
    exit(1);
}

static void out_of_bounds_access(void)
{
    panic("out of bounds memory access");
}

static uint32_t mul_u32_with_overflow_check(uint32_t a, uint32_t b)
{
    uint32_t c = a * b;
    if (c / a != b) {
        panic("integer overflow");
    }
    return c;
}

static void bounds_check(const void *sp, size_t sz)
{
    const void *memory_sp = (const void *)memory;
    const void *memory_ep = (const uint8_t *)memory_sp + (1 << 16);
    const void *ep = (const uint8_t *)sp + sz;
    if (ep < sp || sp < memory_sp || memory_ep < ep) {
        out_of_bounds_access();
    }
}

static void bounds_check_cstr(const void* p)
{
    const uint8_t* memory_sp = (uint8_t*)memory;
    const uint8_t* memory_ep = memory_sp + (1 << 16);
    const uint8_t* ptr_p = (const uint8_t*)p;
    if (ptr_p < memory_sp || memory_ep <= ptr_p) {
        out_of_bounds_access();
    }
    for (const uint8_t* ptr = ptr_p; ; ++ptr) {
        if (memory_ep <= ptr) {
            out_of_bounds_access();
        }
        if (*ptr == 0) {
            break;
        }
    }
}

void w4_runtimeInit (uint8_t* memoryBytes, w4_Disk* diskBytes) {
    memory = (Memory*)memoryBytes;
    disk = diskBytes;
    firstFrame = true;

    // Set memory to initial state
    memset(memory, 0, 1 << 16);
    w4_write32LE(&memory->palette[0], 0xe0f8cf);
    w4_write32LE(&memory->palette[1], 0x86c06c);
    w4_write32LE(&memory->palette[2], 0x306850);
    w4_write32LE(&memory->palette[3], 0x071821);
    memory->drawColors[0] = 0x03;
    memory->drawColors[1] = 0x12;
    w4_write16LE(&memory->mouseX, 0x7fff);
    w4_write16LE(&memory->mouseY, 0x7fff);

    // Initialize gamepad recorder
    w4_gamepadRecorderInit(&gamepadRecorder);

    w4_apuInit();
    w4_framebufferInit(memory->drawColors, memory->framebuffer);
}

void w4_runtimeReset (void) {
    if (memory == NULL) {
        return; // Runtime not initialized
    }
    
    // Reset memory to initial state (but don't re-initialize WASM)
    // memset(memory, 0, sizeof(Memory));
    w4_write32LE(&memory->palette[0], 0xe0f8cf);
    w4_write32LE(&memory->palette[1], 0x86c06c);
    w4_write32LE(&memory->palette[2], 0x306850);
    w4_write32LE(&memory->palette[3], 0x071821);
    memory->drawColors[0] = 0x03;
    memory->drawColors[1] = 0x12;
    w4_write16LE(&memory->mouseX, 0x7fff);
    w4_write16LE(&memory->mouseY, 0x7fff);
    
    // Reset frame counter
    firstFrame = true;
    
    // Re-initialize audio and framebuffer
    w4_apuInit();
    w4_framebufferInit(memory->drawColors, memory->framebuffer);
}

void w4_runtimeSetGamepad (int idx, uint8_t gamepad) {
    memory->gamepads[idx] = gamepad;
}

void w4_runtimeSetMouse (int16_t x, int16_t y, uint8_t buttons) {
    w4_write16LE(&memory->mouseX, x);
    w4_write16LE(&memory->mouseY, y);
    memory->mouseButtons = buttons;
}

void w4_runtimeBlit (const uint8_t* sprite, int x, int y, int width, int height, int flags) {
    // printf("blit: %p, %d, %d, %d, %d, %d\n", sprite, x, y, width, height, flags);

    w4_runtimeBlitSub(sprite, x, y, width, height, 0, 0, width, flags);
}

void w4_runtimeBlitSub (const uint8_t* sprite, int x, int y, int width, int height, int srcX, int srcY, int stride, int flags) {
    // printf("blitSub: %p, %d, %d, %d, %d, %d, %d, %d, %d\n", sprite, x, y, width, height, srcX, srcY, stride, flags);

    bool bpp2 = (flags & 1);
    bool flipX = (flags & 2);
    bool flipY = (flags & 4);
    bool rotate = (flags & 8);
    uint32_t bpp = (int)bpp2 + 1;
    uint32_t nbits = mul_u32_with_overflow_check(mul_u32_with_overflow_check(width, height), bpp);
    bounds_check(sprite, nbits / 8);
    w4_framebufferBlit(sprite, x, y, width, height, srcX, srcY, stride, bpp2, flipX, flipY, rotate);
}

void w4_runtimeLine (int x1, int y1, int x2, int y2) {
    // printf("line: %d, %d, %d, %d\n", x1, y1, x2, y2);
    w4_framebufferLine(x1, y1, x2, y2);
}

void w4_runtimeHLine (int x, int y, int len) {
    // printf("hline: %d, %d, %d\n", x, y, len);
    w4_framebufferHLine(x, y, len);
}

void w4_runtimeVLine (int x, int y, int len) {
    // printf("vline: %d, %d, %d\n", x, y, len);
    w4_framebufferVLine(x, y, len);
}

void w4_runtimeOval (int x, int y, int width, int height) {
    // printf("oval: %d, %d, %d, %d\n", x, y, width, height);
    w4_framebufferOval(x, y, width, height);
}

void w4_runtimeRect (int x, int y, int width, int height) {
    // printf("rect: %d, %d, %d, %d\n", x, y, width, height);
    w4_framebufferRect(x, y, width, height);
}

void w4_runtimeText (const uint8_t* str, int x, int y) {
    bounds_check_cstr(str);
    // printf("text: %s, %d, %d\n", str, x, y);
    w4_framebufferText(str, x, y);
}

void w4_runtimeTextUtf8 (const uint8_t* str, int byteLength, int x, int y) {
    bounds_check(str, byteLength);
    // printf("textUtf8: %p, %d, %d, %d\n", str, byteLength, x, y);
    w4_framebufferTextUtf8(str, byteLength, x, y);
}

void w4_runtimeTextUtf16 (const uint16_t* str, int byteLength, int x, int y) {
    bounds_check(str, byteLength);
    // printf("textUtf16: %p, %d, %d, %d\n", str, byteLength, x, y);
    w4_framebufferTextUtf16(str, byteLength, x, y);
}

void w4_runtimeTone (int frequency, int duration, int volume, int flags) {
    // printf("tone: %d, %d, %d, %d\n", frequency, duration, volume, flags);
    w4_apuTone(frequency, duration, volume, flags);
}

int w4_runtimeDiskr (uint8_t* dest, int size) {
    bounds_check(dest, size);
    if (!disk) {
        return 0;
    }

    if (size > disk->size) {
        size = disk->size;
    }
    memcpy(dest, disk->data, size);
    return size;
}

int w4_runtimeDiskw (const uint8_t* src, int size) {
    bounds_check(src, size);
    if (!disk) {
        return 0;
    }

    if (size > 1024) {
        size = 1024;
    }
    disk->size = size;
    memcpy(disk->data, src, size);
    return size;
}

void w4_runtimeTrace (const uint8_t* str) {
    bounds_check_cstr(str);
    puts(str);
}

void w4_runtimeTraceUtf8 (const uint8_t* str, int byteLength) {
    bounds_check(str, byteLength);
    printf("%.*s\n", byteLength, str);
}

void w4_runtimeTraceUtf16 (const uint16_t* str, int byteLength) {
    bounds_check(str, byteLength);
    printf("TODO: traceUtf16: %p, %d\n", str, byteLength);
}

void w4_runtimeTracef (const uint8_t* str, const void* stack) {
    const uint8_t* argPtr = stack;
    uint32_t strPtr;
    bounds_check_cstr(str);
    for (; *str != 0; ++str) {
        if (*str == '%') {
            const uint8_t sym = *(++str);
            switch (sym) {
            case 0:
                return; // Interrupted
            case '%':
                putc('%', stdout);
                break;
            case 'c':
                bounds_check(argPtr, 4);
                putc((char)w4_read32LE(argPtr), stdout);
                argPtr += 4;
                break;
            case 'd':
                bounds_check(argPtr, 4);
                printf("%" PRId32, w4_read32LE(argPtr));
                argPtr += 4;
                break;
            case 'x':
                bounds_check(argPtr, 4);
                printf("%" PRIx32, w4_read32LE(argPtr));
                argPtr += 4;
                break;
            case 's':
                bounds_check(argPtr, 4);
                strPtr = w4_read32LE(argPtr);
                argPtr += 4;
                const char *strPtr_host = (const char *)memory + strPtr;
                bounds_check_cstr(strPtr_host);
                printf("%s", strPtr_host);
                break;
            case 'f':
                bounds_check(argPtr, 8);
                printf("%lg", w4_readf64LE(argPtr));
                argPtr += 8;
                break;
            default:
                printf("%%%c", sym);
            }
        } else {
            putc(*str, stdout);
        }
    }
    putc('\n', stdout);
}

bool w4_runtimeUpdate () {
    if (firstFrame) {
        firstFrame = false;
        w4_wasmCallStart();
    } else if (!(memory->systemFlags & SYSTEM_PRESERVE_FRAMEBUFFER)) {
        w4_framebufferClear();
    }
    if (!w4_wasmCallUpdate()) {
        return false;
    }
    w4_apuTick();
    uint32_t palette[4] = {
        w4_read32LE(&memory->palette[0]),
        w4_read32LE(&memory->palette[1]),
        w4_read32LE(&memory->palette[2]),
        w4_read32LE(&memory->palette[3]),
    };
    w4_windowComposite(palette, memory->framebuffer);

    return true;
}

int w4_runtimeSerializeSize () {
    return sizeof(SerializedState);
}

void w4_runtimeSerialize (void* dest) {
    SerializedState* state = dest;
    memcpy(&state->memory, memory, 1 << 16);
    memcpy(&state->disk, disk, sizeof(w4_Disk));
    state->firstFrame = firstFrame;
}

void w4_runtimeUnserialize (const void* src) {
    const SerializedState* state = src;
    memcpy(memory, &state->memory, 1 << 16);
    memcpy(disk, &state->disk, sizeof(w4_Disk));
    firstFrame = state->firstFrame;
}

// Gamepad recording function implementations
void w4_gamepadRecorderInit(w4_GamepadRecorder* recorder) {
    memset(recorder, 0, sizeof(w4_GamepadRecorder));
    recorder->playbackEvents = NULL;
}

void w4_gamepadRecorderStartRecording(w4_GamepadRecorder* recorder) {
    recorder->isRecording = 1;
    recorder->eventCount = 0;
    recorder->currentFrame = 0;
    memset(recorder->previousGamepadState, 0, 4);
    printf("Started gamepad event recording\n");
}

void w4_gamepadRecorderStopRecording(w4_GamepadRecorder* recorder) {
    recorder->isRecording = 0;
    printf("Stopped gamepad event recording. Recorded %u events.\n", recorder->eventCount);
}

void w4_gamepadRecorderRecordFrame(w4_GamepadRecorder* recorder, const uint8_t gamepadState[4]) {
    if (!recorder->isRecording) return;
    
    // Check each player's gamepad for changes
    for (int playerIdx = 0; playerIdx < 4; playerIdx++) {
        uint8_t prevState = recorder->previousGamepadState[playerIdx];
        uint8_t currState = gamepadState[playerIdx];
        
        // Check each button bit
        for (int buttonBit = 0; buttonBit < 8; buttonBit++) {
            uint8_t buttonMask = 1 << buttonBit;
            bool wasPressed = (prevState & buttonMask) != 0;
            bool isPressed = (currState & buttonMask) != 0;
            
            // Record press event
            if (!wasPressed && isPressed && recorder->eventCount < 4096) {
                w4_GamepadEvent* event = &recorder->events[recorder->eventCount++];
                event->frame = recorder->currentFrame;
                event->playerIdx = playerIdx;
                event->button = buttonMask;
                event->eventType = W4_GAMEPAD_EVENT_PRESS;
                event->padding = 0;
            }
            
            // Record release event
            if (wasPressed && !isPressed && recorder->eventCount < 4096) {
                w4_GamepadEvent* event = &recorder->events[recorder->eventCount++];
                event->frame = recorder->currentFrame;
                event->playerIdx = playerIdx;
                event->button = buttonMask;
                event->eventType = W4_GAMEPAD_EVENT_RELEASE;
                event->padding = 0;
            }
        }
    }
    
    // Update previous state and increment frame
    memcpy(recorder->previousGamepadState, gamepadState, 4);
    recorder->currentFrame++;
}

void w4_gamepadRecorderStartPlayback(w4_GamepadRecorder* recorder, const w4_GamepadEvent* events, uint32_t eventCount) {
    recorder->isPlaying = 1;
    recorder->playbackEvents = (w4_GamepadEvent*)events;
    recorder->playbackEventCount = eventCount;
    recorder->playbackFrame = 0;
    printf("Started playback of %u events\n", eventCount);
}

void w4_gamepadRecorderStopPlayback(w4_GamepadRecorder* recorder) {
    recorder->isPlaying = 0;
    recorder->playbackEvents = NULL;
    recorder->playbackEventCount = 0;
    recorder->playbackFrame = 0;
    printf("Stopped playback\n");
}

void w4_gamepadRecorderGetPlaybackState(w4_GamepadRecorder* recorder, uint8_t gamepadState[4]) {
    memset(gamepadState, 0, 4);
    
    if (!recorder->isPlaying || !recorder->playbackEvents) {
        return;
    }
    
    // Apply all events up to current frame
    for (uint32_t i = 0; i < recorder->playbackEventCount; i++) {
        const w4_GamepadEvent* event = &recorder->playbackEvents[i];
        if (event->frame <= recorder->playbackFrame) {
            if (event->eventType == W4_GAMEPAD_EVENT_PRESS) {
                gamepadState[event->playerIdx] |= event->button;
            } else if (event->eventType == W4_GAMEPAD_EVENT_RELEASE) {
                gamepadState[event->playerIdx] &= ~event->button;
            }
        }
    }
    
    recorder->playbackFrame++;
}

int w4_gamepadRecorderSerialize(const w4_GamepadRecorder* recorder, uint8_t* dest, int maxSize) {
    // Calculate required size: 4 bytes header + 8 bytes per event
    int headerSize = 4;
    int eventSize = 8;
    int requiredSize = headerSize + (recorder->eventCount * eventSize);
    
    if (requiredSize > maxSize) {
        return -1; // Not enough space
    }
    
    // Write header: event count (4 bytes, little endian)
    dest[0] = recorder->eventCount & 0xFF;
    dest[1] = (recorder->eventCount >> 8) & 0xFF;
    dest[2] = (recorder->eventCount >> 16) & 0xFF;
    dest[3] = (recorder->eventCount >> 24) & 0xFF;
    
    // Write events
    int offset = headerSize;
    for (uint32_t i = 0; i < recorder->eventCount; i++) {
        const w4_GamepadEvent* event = &recorder->events[i];
        
        // Frame number (4 bytes, little endian)
        dest[offset + 0] = event->frame & 0xFF;
        dest[offset + 1] = (event->frame >> 8) & 0xFF;
        dest[offset + 2] = (event->frame >> 16) & 0xFF;
        dest[offset + 3] = (event->frame >> 24) & 0xFF;
        
        // Player index, button, event type, padding (4 bytes)
        dest[offset + 4] = event->playerIdx;
        dest[offset + 5] = event->button;
        dest[offset + 6] = event->eventType;
        dest[offset + 7] = 0; // padding
        
        offset += eventSize;
    }
    
    return requiredSize;
}

int w4_gamepadRecorderDeserialize(w4_GamepadRecorder* recorder, const uint8_t* src, int size) {
    if (size < 4) {
        return -1; // Invalid size
    }
    
    // Read header: event count (4 bytes, little endian)
    uint32_t eventCount = src[0] | (src[1] << 8) | (src[2] << 16) | (src[3] << 24);
    
    int headerSize = 4;
    int eventSize = 8;
    int expectedSize = headerSize + (eventCount * eventSize);
    
    if (size != expectedSize || eventCount > 4096) {
        return -1; // Invalid data
    }
    
    // Read events
    int offset = headerSize;
    for (uint32_t i = 0; i < eventCount; i++) {
        w4_GamepadEvent* event = &recorder->events[i];
        
        // Frame number (4 bytes, little endian)
        event->frame = src[offset + 0] | (src[offset + 1] << 8) | 
                      (src[offset + 2] << 16) | (src[offset + 3] << 24);
        
        // Player index, button, event type
        event->playerIdx = src[offset + 4];
        event->button = src[offset + 5];
        event->eventType = src[offset + 6];
        event->padding = 0;
        
        offset += eventSize;
    }
    
    recorder->eventCount = eventCount;
    return 0;
}

void w4_gamepadRecorderExportToFile(const w4_GamepadRecorder* recorder, const char* filename) {
    uint8_t buffer[32768]; // 32KB buffer should be enough for most recordings
    int size = w4_gamepadRecorderSerialize(recorder, buffer, sizeof(buffer));
    
    if (size > 0) {
        FILE* file = fopen(filename, "wb");
        if (file) {
            fwrite(buffer, 1, size, file);
            fclose(file);
            printf("Exported %u gamepad events to %s (%d bytes)\n", recorder->eventCount, filename, size);
        } else {
            printf("Failed to open file %s for writing\n", filename);
        }
    } else {
        printf("Failed to serialize gamepad events\n");
    }
}

int w4_gamepadRecorderLoadFromFile(w4_GamepadRecorder* recorder, const char* filename) {
    FILE* file = fopen(filename, "rb");
    if (!file) {
        printf("Failed to open file %s for reading\n", filename);
        return -1;
    }
    
    // Get file size
    fseek(file, 0, SEEK_END);
    long fileSize = ftell(file);
    fseek(file, 0, SEEK_SET);
    
    if (fileSize > 32768) {
        printf("File %s is too large (%ld bytes)\n", filename, fileSize);
        fclose(file);
        return -1;
    }
    
    uint8_t buffer[32768];
    size_t bytesRead = fread(buffer, 1, fileSize, file);
    fclose(file);
    
    if (bytesRead != fileSize) {
        printf("Failed to read complete file %s\n", filename);
        return -1;
    }
    
    int result = w4_gamepadRecorderDeserialize(recorder, buffer, fileSize);
    if (result == 0) {
        printf("Loaded %u gamepad events from %s\n", recorder->eventCount, filename);
        w4_gamepadRecorderStartPlayback(recorder, recorder->events, recorder->eventCount);
    } else {
        printf("Failed to deserialize gamepad events from %s\n", filename);
    }
    
    return result;
}
