#include <MiniFB.h>
#include <stdio.h>
#include <time.h>
#include <string.h>

#include "../window.h"
#include "../runtime.h"



static uint32_t pixels[160*160];

static int viewportX = 0;
static int viewportY = 0;
static int viewportSize = 3*160;

static void onResize (struct mfb_window* window, int width, int height) {
    viewportSize = (width < height) ? width : height;
    viewportX = width/2 - viewportSize/2;
    viewportY = height/2 - viewportSize/2;

    mfb_set_viewport(window, viewportX, viewportY, viewportSize, viewportSize);
}

void w4_windowBoot (const char* title) {
    struct mfb_window* window = mfb_open_ex(title, viewportSize, viewportSize, WF_RESIZABLE);

    mfb_set_resize_callback(window, onResize);
    
    // Target 15 FPS (66.67ms per frame)
    const double targetFrameTime = 1.0 / 10.0;
    struct timespec lastTime, currentTime;
    clock_gettime(CLOCK_MONOTONIC, &lastTime);
    struct timespec statTime = lastTime;
    long statFps = 0;

    do {
        // Keyboard handling
        const uint8_t* keyBuffer = mfb_get_key_buffer(window);
        
        // Handle hotkeys (F4-F8)
        static uint8_t prevKeyState[KB_KEY_LAST] = {0};
        

        // F5 - Export Events
        if (keyBuffer[KB_KEY_F5] && !prevKeyState[KB_KEY_F5]) {
            if (keyBuffer[KB_KEY_LEFT_SHIFT] || keyBuffer[KB_KEY_RIGHT_SHIFT]) {
                // Export as JSON
                if (gamepadRecorder.eventCount > 0) {
                    char filename[64];
                    snprintf(filename, sizeof(filename), "gamepad-events-%ld.json", time(NULL));
                    w4_gamepadRecorderExportToJSONFile(&gamepadRecorder, filename);
                } else {
                    printf("No gamepad events to export\n");
                }
            } else {
                // Export as binary
                if (gamepadRecorder.eventCount > 0) {
                    char filename[64];
                    snprintf(filename, sizeof(filename), "gamepad-events-%ld.bin", time(NULL));
                    w4_gamepadRecorderExportToFile(&gamepadRecorder, filename);
                } else {
                    printf("No gamepad events to export\n");
                }
            }
        }
        
        // F6 - Show Status
        if (keyBuffer[KB_KEY_F6] && !prevKeyState[KB_KEY_F6]) {
            const char* status = gamepadRecorder.isRecording ? "Recording" : 
                               gamepadRecorder.isPlaying ? "Playing" : "Stopped";
            printf("Gamepad Status: %s | Frame: %u | Events: %u\n", 
                   status, gamepadRecorder.currentFrame, gamepadRecorder.eventCount);
        }
        
        // F7 - Load and Replay
        if (keyBuffer[KB_KEY_F7] && !prevKeyState[KB_KEY_F7]) {
            if (gamepadRecorder.isPlaying) {
                w4_gamepadRecorderStopPlayback(&gamepadRecorder);
            } else {
                printf("Loading gamepad-events.bin...\n");
                char filename[256] = "gamepad-events.bin";
                // For simplicity, use a default filename in this implementation
                if (w4_gamepadRecorderLoadFromFile(&gamepadRecorder, filename) == 0) {
                    // Reset runtime for playback
                    w4_runtimeReset();
                    printf("Runtime restarted - Gamepad playback started\n");
                }
            }
        }
        
        // F8 - Show Help
        if (keyBuffer[KB_KEY_F8] && !prevKeyState[KB_KEY_F8]) {
            printf("\n🎮 WASM-4 MiniFB Runtime Hotkeys:\n");
            printf("F4 - Start/Stop Gamepad Recording (restarts runtime)\n");
            printf("F5 - Export Gamepad Events to file (binary)\n");
            printf("Shift+F5 - Export Gamepad Events to file (JSON)\n");
            printf("F6 - Show Recording Status\n");
            printf("F7 - Load & Replay Events from file (restarts runtime)\n");
            printf("F8 - Show This Help\n\n");
        }
        
        // Update previous key state
        memcpy(prevKeyState, keyBuffer, KB_KEY_LAST);

        // Player 1
        uint8_t gamepad = 0;
        if (keyBuffer[KB_KEY_X] || keyBuffer[KB_KEY_V] || keyBuffer[KB_KEY_K] || keyBuffer[KB_KEY_SPACE]) {
            gamepad |= W4_BUTTON_X;
        }
        if (keyBuffer[KB_KEY_Z] || keyBuffer[KB_KEY_C] || keyBuffer[KB_KEY_Y] || keyBuffer[KB_KEY_W] || keyBuffer[KB_KEY_J]) {
            gamepad |= W4_BUTTON_Z;
        }
        if (keyBuffer[KB_KEY_LEFT]) {
            gamepad |= W4_BUTTON_LEFT;
        }
        if (keyBuffer[KB_KEY_RIGHT]) {
            gamepad |= W4_BUTTON_RIGHT;
        }
        if (keyBuffer[KB_KEY_UP]) {
            gamepad |= W4_BUTTON_UP;
        }
        if (keyBuffer[KB_KEY_DOWN]) {
            gamepad |= W4_BUTTON_DOWN;
        }
        w4_runtimeSetGamepad(0, gamepad);

        // Player 2
        gamepad = 0;
        if (keyBuffer[KB_KEY_LEFT_SHIFT] || keyBuffer[KB_KEY_TAB]) {
            gamepad |= W4_BUTTON_X;
        }
        if (keyBuffer[KB_KEY_A] || keyBuffer[KB_KEY_Q]) {
            gamepad |= W4_BUTTON_Z;
        }
        if (keyBuffer[KB_KEY_S]) {
            gamepad |= W4_BUTTON_LEFT;
        }
        if (keyBuffer[KB_KEY_F]) {
            gamepad |= W4_BUTTON_RIGHT;
        }
        if (keyBuffer[KB_KEY_E]) {
            gamepad |= W4_BUTTON_UP;
        }
        if (keyBuffer[KB_KEY_D]) {
            gamepad |= W4_BUTTON_DOWN;
        }
        w4_runtimeSetGamepad(1, gamepad);

        // Collect gamepad states for recording
        uint8_t currentGamepadState[4];
        memcpy(currentGamepadState, memory->gamepads, 4);
        
        // Use playback events if playing, otherwise use real input

        if (gamepadRecorder.isPlaying) {
            uint8_t playbackState[4];
            w4_gamepadRecorderGetPlaybackState(&gamepadRecorder, playbackState);
            // Override the gamepad states with playback data
            w4_runtimeSetGamepad(0, playbackState[0]);
            w4_runtimeSetGamepad(1, playbackState[1]);
            w4_runtimeSetGamepad(2, playbackState[2]);
            w4_runtimeSetGamepad(3, playbackState[3]);
        } else {
            // Record gamepad events for this frame only when not playing back
            w4_gamepadRecorderRecordFrame(&gamepadRecorder, currentGamepadState);
        }

        // Mouse handling
        uint8_t mouseButtons = 0;
        const uint8_t* mouseBuffer = mfb_get_mouse_button_buffer(window);
        if (mouseBuffer[MOUSE_LEFT]) {
            mouseButtons |= W4_MOUSE_LEFT;
        }
        if (mouseBuffer[MOUSE_RIGHT]) {
            mouseButtons |= W4_MOUSE_RIGHT;
        }
        if (mouseBuffer[MOUSE_MIDDLE]) {
            mouseButtons |= W4_MOUSE_MIDDLE;
        }
        int mouseX = mfb_get_mouse_x(window);
        int mouseY = mfb_get_mouse_y(window);
        w4_runtimeSetMouse(160*(mouseX-viewportX)/viewportSize, 160*(mouseY-viewportY)/viewportSize, mouseButtons);

        if (!w4_runtimeUpdate()) {
            break;
        }

        if (mfb_update_ex(window, pixels, 160, 160) < 0) {
            break;
        }
        
        // Frame rate limiting to 15 FPS
        clock_gettime(CLOCK_MONOTONIC, &currentTime);
        double elapsed = (currentTime.tv_sec - lastTime.tv_sec) + 
                        (currentTime.tv_nsec - lastTime.tv_nsec) / 1000000000.0;
        
        if (elapsed < targetFrameTime) {
            double sleepTime = targetFrameTime - elapsed;
            struct timespec sleepSpec = {
                .tv_sec = (time_t)sleepTime,
                .tv_nsec = (long)((sleepTime - (time_t)sleepTime) * 1000000000)
            };
            nanosleep(&sleepSpec, NULL);
        }

        clock_gettime(CLOCK_MONOTONIC, &currentTime);

        statFps++;
        double elapsedStat = (currentTime.tv_sec - statTime.tv_sec) + 
                            (currentTime.tv_nsec - statTime.tv_nsec) / 1000000000.0;
        if (elapsedStat >= 1.0) {
            printf("FPS: %ld\n", statFps);
            statTime = currentTime;
            statFps = 0;
        }

        
        lastTime = currentTime;
        
    } while (mfb_wait_sync(window));

    // Save recordings on exit
    if (gamepadRecorder.eventCount > 0) {
        char basename[64];
        snprintf(basename, sizeof(basename), "gamepad-events-%ld", time(NULL));

        char binFilename[70];
        snprintf(binFilename, sizeof(binFilename), "%s.bin", basename);
        w4_gamepadRecorderExportToFile(&gamepadRecorder, binFilename);

        char jsonFilename[71];
        snprintf(jsonFilename, sizeof(jsonFilename), "%s.json", basename);
        w4_gamepadRecorderExportToJSONFile(&gamepadRecorder, jsonFilename);
    }
}

void w4_windowComposite (const uint32_t* palette, const uint8_t* framebuffer) {
    // Convert indexed 2bpp framebuffer to XRGB output
    uint32_t* out = pixels;
    for (int n = 0; n < 160*160/4; ++n) {
        uint8_t quartet = framebuffer[n];
        int color1 = (quartet & 0b00000011) >> 0;
        int color2 = (quartet & 0b00001100) >> 2;
        int color3 = (quartet & 0b00110000) >> 4;
        int color4 = (quartet & 0b11000000) >> 6;

        *out++ = palette[color1];
        *out++ = palette[color2];
        *out++ = palette[color3];
        *out++ = palette[color4];
    }
}
