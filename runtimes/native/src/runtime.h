#pragma once

#include <stdint.h>
#include <stdbool.h>

#define W4_BUTTON_X 1
#define W4_BUTTON_Z 2
// #define W4_BUTTON_RESERVED 4
// #define W4_BUTTON_RESERVED 8
#define W4_BUTTON_LEFT 16
#define W4_BUTTON_RIGHT 32
#define W4_BUTTON_UP 64
#define W4_BUTTON_DOWN 128

#define W4_MOUSE_LEFT 1
#define W4_MOUSE_RIGHT 2
#define W4_MOUSE_MIDDLE 4

typedef struct {
    uint32_t game_mode;
    uint32_t max_frames;
    uint32_t game_seed;
    uint32_t frames;
    uint32_t score;
    uint32_t health;
} w4_PersistentData;

typedef struct {
    uint16_t size;
    uint8_t data[1024];
} w4_Disk;

// Exit info structure
typedef struct {
    int exitCode;
    char message[256];
} w4_ExitInfo;

// Input event structure
typedef struct {
    uint32_t frame;
    uint8_t type;
    uint8_t data[8];
} w4_InputEvent;

// Gamepad event recording structures
typedef enum {
    W4_GAMEPAD_EVENT_PRESS = 0,
    W4_GAMEPAD_EVENT_RELEASE = 1
} w4_GamepadEventType;

typedef struct {
    uint32_t frame;
    uint8_t playerIdx;
    uint8_t button;
    uint8_t eventType;
    uint8_t padding;
} w4_GamepadEvent;

typedef struct {
    w4_GamepadEvent events[4096];  // Max 4096 events
    uint32_t eventCount;
    uint32_t currentFrame;
    uint8_t previousGamepadState[4];
    uint8_t isRecording;
    uint8_t isPlaying;
    uint32_t playbackFrame;
    uint32_t playbackEventCount;
    w4_GamepadEvent* playbackEvents;
} w4_GamepadRecorder;

void w4_runtimeInit (uint8_t* memory, w4_Disk* disk);
void w4_runtimeReset (void);

void w4_runtimeSetGamepad (int idx, uint8_t gamepad);
void w4_runtimeSetMouse (int16_t x, int16_t y, uint8_t buttons);

void w4_runtimeBlit (const uint8_t* sprite, int x, int y, int width, int height, int flags);
void w4_runtimeBlitSub (const uint8_t* sprite, int x, int y, int width, int height, int srcX, int srcY, int stride, int flags);
void w4_runtimeLine (int x1, int y1, int x2, int y2);
void w4_runtimeHLine (int x, int y, int len);
void w4_runtimeVLine (int x, int y, int len);
void w4_runtimeOval (int x, int y, int width, int height);
void w4_runtimeRect (int x, int y, int width, int height);
void w4_runtimeText (const uint8_t* str, int x, int y);
void w4_runtimeTextUtf8 (const uint8_t* str, int byteLength, int x, int y);
void w4_runtimeTextUtf16 (const uint16_t* str, int byteLength, int x, int y);

void w4_runtimeTone (int frequency, int duration, int volume, int flags);

int w4_runtimeDiskr (uint8_t* dest, int size);
int w4_runtimeDiskw (const uint8_t* src, int size);

void w4_runtimeTrace (const uint8_t* str);
void w4_runtimeTraceUtf8 (const uint8_t* str, int byteLength);
void w4_runtimeTraceUtf16 (const uint16_t* str, int byteLength);
void w4_runtimeTracef (const uint8_t* str, const void* stack);

bool w4_runtimeUpdate ();

int w4_runtimeSerializeSize ();
void w4_runtimeSerialize (void* dest);
void w4_runtimeUnserialize (const void* src);

// Gamepad recording functions
void w4_gamepadRecorderInit (w4_GamepadRecorder* recorder);
void w4_gamepadRecorderStartRecording (w4_GamepadRecorder* recorder);
void w4_gamepadRecorderStopRecording (w4_GamepadRecorder* recorder);
void w4_gamepadRecorderRecordFrame (w4_GamepadRecorder* recorder, const uint8_t gamepadState[4]);
void w4_gamepadRecorderStartPlayback (w4_GamepadRecorder* recorder, const w4_GamepadEvent* events, uint32_t eventCount);
void w4_gamepadRecorderStopPlayback (w4_GamepadRecorder* recorder);
void w4_gamepadRecorderGetPlaybackState (w4_GamepadRecorder* recorder, uint8_t gamepadState[4]);
int w4_gamepadRecorderSerialize (const w4_GamepadRecorder* recorder, uint8_t* dest, int maxSize);
int w4_gamepadRecorderDeserialize (w4_GamepadRecorder* recorder, const uint8_t* src, int size);
void w4_gamepadRecorderExportToFile (const w4_GamepadRecorder* recorder, const char* filename);
int w4_gamepadRecorderLoadFromFile (w4_GamepadRecorder* recorder, const char* filename);

// Memory structure definition
#pragma pack(1)
typedef struct {
    uint8_t _padding[4];
    uint32_t palette[4];
    uint8_t drawColors[2];
    uint8_t gamepads[4];
    int16_t mouseX;
    int16_t mouseY;
    uint8_t mouseButtons;
    uint8_t systemFlags;
    uint8_t _reserved[128];
    w4_PersistentData persistent;  // Persistent area for cart data (scores, settings, etc.)
    uint8_t framebuffer[160*160>>2];
    uint8_t _user[58720];     // Reduced by 256 bytes to accommodate persistent area
} Memory;
#pragma pack()

// Global variable declarations
extern w4_GamepadRecorder gamepadRecorder;
extern Memory* memory;
extern w4_Disk* disk;
