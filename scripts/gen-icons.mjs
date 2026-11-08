// Generate CortexOS extension icons (brain-circuit glyph → PNG set).
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6366f1"/>
      <stop offset="1" stop-color="#8b5cf6"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="#0f0f14"/>
  <path d="M64 22c-14 0-24 8-26 19-9 2-15 9-15 18 0 8 5 15 12 18 1 12 11 21 23 21 5 0 9-1 13-4V34c-2-1-4-1-7-1z" fill="url(#g)" opacity="0.9"/>
  <path d="M64 22c14 0 24 8 26 19 9 2 15 9 15 18 0 8-5 15-12 18-1 12-11 21-23 21-5 0-9-1-13-4V34c2-1 4-1 7-1z" fill="url(#g)"/>
  <circle cx="48" cy="58" r="5" fill="#0f0f14"/>
  <circle cx="80" cy="58" r="5" fill="#0f0f14"/>
  <path d="M50 76c4 5 10 8 14 8s10-3 14-8" stroke="#0f0f14" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M64 14v8M40 20l4 7M88 20l-4 7" stroke="#a5b4fc" stroke-width="3" stroke-linecap="round"/>
  <path d="M30 44h-8M106 44h8M28 66h-8M108 66h8" stroke="#6366f1" stroke-width="3" stroke-linecap="round"/>
</svg>`

mkdirSync('extension/icons', { recursive: true })
for (const size of [16, 32, 48, 128]) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`extension/icons/icon-${size}.png`)
  console.log(`icon-${size}.png written`)
}
