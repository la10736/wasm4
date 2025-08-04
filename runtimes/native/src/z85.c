/*
 * Copyright 2013 Stanislav Artemkin <artemkin@gmail.com>.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * Implementation of 32/Z85 specification (http://rfc.zeromq.org/spec:32/Z85)
 * Source repository: http://github.com/artemkin/z85
 */

#include <stdint.h>
#include <stddef.h>
#include <assert.h>
#include <limits.h>

#include "z85.h"

#define DIV85_MAGIC 3233857729ULL

static const char* encoder =
{
   "0123456789"
   "abcdefghij"
   "klmnopqrst"
   "uvwxyzABCD"
   "EFGHIJKLMN"
   "OPQRSTUVWX"
   "YZ.-:+=^!/"
   "*?&<>()[]{"
   "}@%$#"
};

static uint8_t decoder[] =
{
   0x00, 0x44, 0x00, 0x54, 0x53, 0x52, 0x48, 0x00,
   0x4B, 0x4C, 0x46, 0x41, 0x00, 0x3F, 0x3E, 0x45,
   0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
   0x08, 0x09, 0x40, 0x00, 0x49, 0x42, 0x4A, 0x47,
   0x51, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2A,
   0x2B, 0x2C, 0x2D, 0x2E, 0x2F, 0x30, 0x31, 0x32,
   0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A,
   0x3B, 0x3C, 0x3D, 0x4D, 0x00, 0x4E, 0x43, 0x00,
   0x00, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10,
   0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
   0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x1E, 0x1F, 0x20,
   0x21, 0x22, 0x23, 0x4F, 0x00, 0x50, 0x00, 0x00
};

char* Z85_encode_unsafe(const char* source, const char* sourceEnd, char* dest)
{
   uint8_t* src = (uint8_t*)source;
   uint8_t* end = (uint8_t*)sourceEnd;
   uint8_t* dst = (uint8_t*)dest;
   uint32_t value;
   uint32_t value2;

   for (; src != end; src += 4, dst += 5)
   {
      value = (src[0] << 24) | (src[1] << 16) | (src[2] << 8) | src[3];

      value2 = (uint32_t)((DIV85_MAGIC * value) >> 32) >> 6; dst[4] = encoder[value - value2 * 85]; value = value2;
      value2 = (uint32_t)((DIV85_MAGIC * value) >> 32) >> 6; dst[3] = encoder[value - value2 * 85]; value = value2;
      value2 = (uint32_t)((DIV85_MAGIC * value) >> 32) >> 6; dst[2] = encoder[value - value2 * 85]; value = value2;
      value2 = (uint32_t)((DIV85_MAGIC * value) >> 32) >> 6; dst[1] = encoder[value - value2 * 85];
      dst[0] = encoder[value2];
   }

   return (char*)dst;
}

char* Z85_decode_unsafe(const char* source, const char* sourceEnd, char* dest)
{
   uint8_t* src = (uint8_t*)source;
   uint8_t* end = (uint8_t*)sourceEnd;
   uint8_t* dst = (uint8_t*)dest;
   uint32_t value;

   for (; src != end; src += 5, dst += 4)
   {
      value =              decoder[(src[0] - 32) & 0x7F];
      value = value * 85 + decoder[(src[1] - 32) & 0x7F];
      value = value * 85 + decoder[(src[2] - 32) & 0x7F];
      value = value * 85 + decoder[(src[3] - 32) & 0x7F];
      value = value * 85 + decoder[(src[4] - 32) & 0x7F];

      dst[0] = value >> 24;
      dst[1] = (uint8_t)(value >> 16);
      dst[2] = (uint8_t)(value >> 8);
      dst[3] = (uint8_t)(value);
   }

   return (char*)dst;
}

size_t Z85_encode_bound(size_t size)
{
   return size * 5 / 4;
}

size_t Z85_decode_bound(size_t size)
{
   return size * 4 / 5;
}

size_t Z85_encode(const char* source, char* dest, size_t inputSize)
{
   if (inputSize % 4)
   {
      return 0;
   }

   return Z85_encode_unsafe(source, source + inputSize, dest) - dest;
}

size_t Z85_decode(const char* source, char* dest, size_t inputSize)
{
   if (inputSize % 5)
   {
      return 0;
   }

   return Z85_decode_unsafe(source, source + inputSize, dest) - dest;
}
