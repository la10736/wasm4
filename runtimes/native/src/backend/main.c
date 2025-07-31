#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include <cubeb/cubeb.h>


#include "../apu.h"
#include "../runtime.h"
#include "../wasm.h"
#include "../window.h"
#include "../util.h"

#if defined(_WIN32)
#include <windows.h>
#endif

#define DISK_FILE_EXT ".disk"

typedef struct {
    // Should be the 4 byte ASCII string "CART" (1414676803)
    uint32_t magic;

    // Window title
    char title[128];

    // Length of the cart.wasm bytes used to offset backwards from the footer
    uint32_t cartLength;
} FileFooter;

static long audioDataCallback (cubeb_stream* stream, void* userData,
    const void* inputBuffer, void* outputBuffer, long frames)
{
    w4_apuWriteSamples((int16_t*)outputBuffer, frames);
    return frames;
}

static void audioStateCallback (cubeb_stream* stream, void* userData, cubeb_state state) {
}

static void audioInit () {
    cubeb* ctx;

#if defined(_WIN32)
    // This initialziation is required for cubeb on windows
    // It's safe to ignore the return value of this, as there's no real failure mode
    CoInitializeEx(NULL, COINIT_MULTITHREADED | COINIT_DISABLE_OLE1DDE);
#endif
    if (cubeb_init(&ctx, "WASM-4", NULL)) {
        fprintf(stderr, "Could not init audio\n");
        return;
    }

    cubeb_stream_params params;
    params.format = CUBEB_SAMPLE_S16NE;
    params.rate = 44100;
    params.channels = 2;
    params.layout = CUBEB_LAYOUT_UNDEFINED;
    params.prefs = CUBEB_STREAM_PREF_NONE;

    uint32_t latency;
    if (cubeb_get_min_latency(ctx, &params, &latency)) {
        fprintf(stderr, "Could not get minimum latency\n");
        return;
    }

    cubeb_stream* stream;
    if (cubeb_stream_init(ctx, &stream, "WASM-4", NULL, NULL, NULL, &params,
            latency, audioDataCallback, audioStateCallback, NULL)) {
        fprintf(stderr, "Could not open the stream\n");
        return;
    }

    if (cubeb_stream_start(stream)) {
        fprintf(stderr, "Could not start the stream\n");
        return;
    }
}

static void audioUninit () {
#if defined(_WIN32)
    CoUninitialize();
#endif
}

static void loadDiskFile (w4_Disk* disk, const char *diskPath) {
    FILE *file = fopen(diskPath, "rb");
    if (file) {
        fseek(file, 0, SEEK_END);
        uint16_t saveSz = ftell(file);
        fseek(file, 0, SEEK_SET);
        if (saveSz > sizeof(disk->data)) {
            saveSz = sizeof(disk->data);
        }
        disk->size = fread(disk->data, 1, saveSz, file);
        fclose(file);
    }
}

static void saveDiskFile (const w4_Disk* disk, const char *diskPath) {
    if (disk->size) {
        FILE* file = fopen(diskPath, "wb");
        fwrite(disk->data, 1, disk->size, file);
        fclose(file);
    } else {
        remove(diskPath);
    }
}

static void trimFileExtension (char *path) {
    size_t len = strlen(path);
    while (len--) {
        if (path[len] == '.') {
            path[len] = 0; // Set null terminator
            return;
        } else if (path[len] == '/' || path[len] == '\\') {
            return;
        }
    }
}

int main (int argc, const char* argv[]) {
    uint8_t* cartBytes;
    size_t cartLength;
    w4_Disk disk = {0};
    const char* title = "WASM-4";
    char* diskPath = NULL;

    if (argc < 2) {
        FILE* file = fopen(argv[0], "rb");
        fseek(file, -sizeof(FileFooter), SEEK_END);

        FileFooter footer;
        if (fread(&footer, 1, sizeof(FileFooter), file) < sizeof(FileFooter) || footer.magic != 1414676803) {
            // No bundled cart found
            fprintf(stderr, "Usage: wasm4 <cart>\n");
            return 1;
        }

        // Make sure the title is null terminated
        footer.title[sizeof(footer.title)-1] = '\0';
        title = footer.title;

        cartBytes = xmalloc(footer.cartLength);
        fseek(file, -sizeof(FileFooter) - footer.cartLength, SEEK_END);
        cartLength = fread(cartBytes, 1, footer.cartLength, file);
        fclose(file);

        // Look for disk file
        diskPath = xmalloc(strlen(argv[0]) + sizeof(DISK_FILE_EXT));
        strcpy(diskPath, argv[0]);
#ifdef _WIN32
        trimFileExtension(diskPath); // Trim .exe on Windows
#endif
        strcat(diskPath, DISK_FILE_EXT);
        loadDiskFile(&disk, diskPath);

    } else if (!strcmp(argv[1], "-") || !strcmp(argv[1], "/dev/stdin")) {
        size_t bufsize = 1024;
        cartBytes = xmalloc(bufsize);
        cartLength = 0;
        int c;

        while((c = getc(stdin)) != EOF) {
            cartBytes[cartLength++] = c;
            if(cartLength == bufsize) {
                if (cartLength >= 64 * 1024) {
                    fprintf(stderr, "Error, overflown cartridge size limit of 64 KB\n");
                    return 1;
                }

                bufsize *= 2;
                cartBytes = xrealloc(cartBytes, bufsize);

                if(!cartBytes) {
                    fprintf(stderr, "Error reallocating cartridge buffer\n");
                    return 1;
                }
            }
        }
    }
    else {
        FILE* file = fopen(argv[1], "rb");
        if (file == NULL) {
            fprintf(stderr, "Error opening %s\n", argv[1]);
            return 1;
        }

        fseek(file, 0, SEEK_END);
        cartLength = ftell(file);
        fseek(file, 0, SEEK_SET);

        cartBytes = xmalloc(cartLength);
        cartLength = fread(cartBytes, 1, cartLength, file);
        fclose(file);

        // Look for disk file
        diskPath = xmalloc(strlen(argv[1]) + sizeof(DISK_FILE_EXT));
        strcpy(diskPath, argv[1]);
        trimFileExtension(diskPath); // Trim .wasm
        strcat(diskPath, DISK_FILE_EXT);
        loadDiskFile(&disk, diskPath);
    }

    audioInit();

    uint8_t* memory = w4_wasmInit();
    w4_runtimeInit(memory, &disk);

    w4_gamepadRecorderInit(&gamepadRecorder);
    w4_gamepadRecorderStartRecording(&gamepadRecorder);

    ((Memory*)memory)->persistent.game_mode = 1;
    ((Memory*)memory)->persistent.max_frames = 600;
    
    struct timespec spec;
    clock_gettime(CLOCK_REALTIME, &spec);
    uint64_t ms = (uint64_t)spec.tv_sec * 1000 + (uint64_t)spec.tv_nsec / 1000000;
    ((Memory*)memory)->persistent.game_seed = (uint32_t)ms;

    printf("Starting in recording mode with seed: %u\n", ((Memory*)memory)->persistent.game_seed);

    w4_wasmLoadModule(cartBytes, cartLength);

    w4_windowBoot(title);

    if (gamepadRecorder.eventCount > 0) {
        char filename[64];
        snprintf(filename, sizeof(filename), "gamepad-events-%u.bin", ((Memory*)memory)->persistent.game_seed);
        w4_gamepadRecorderExportToFile(&gamepadRecorder, filename);
        printf("Saved %u gamepad events to %s\n", gamepadRecorder.eventCount, filename);
    }

    printf("--- Persistent Data ---\n");
    printf("Game Mode:  %u\n", ((Memory*)memory)->persistent.game_mode);
    printf("Max Frames: %u\n", ((Memory*)memory)->persistent.max_frames);
    printf("Game Seed:  %u\n", ((Memory*)memory)->persistent.game_seed);
    printf("Frames:     %u\n", ((Memory*)memory)->persistent.frames);
    printf("Score:      %u\n", ((Memory*)memory)->persistent.score);
    printf("Health:     %u\n", ((Memory*)memory)->persistent.health);
    printf("-----------------------\n");

    audioUninit();

    saveDiskFile(&disk, diskPath);
}
