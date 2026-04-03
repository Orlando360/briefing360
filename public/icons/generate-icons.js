// Run once: node generate-icons.js
const { createCanvas } = require('canvas')
const fs = require('fs')

function makeIcon(size) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  const r = size * 0.15

  // Background
  ctx.fillStyle = '#C9A96E'
  ctx.beginPath()
  ctx.roundRect(0, 0, size, size, r)
  ctx.fill()

  // Symbol ✦
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${Math.round(size * 0.52)}px serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('✦', size / 2, size / 2 + size * 0.02)

  return canvas.toBuffer('image/png')
}

fs.writeFileSync('icon-192.png', makeIcon(192))
fs.writeFileSync('icon-512.png', makeIcon(512))
fs.writeFileSync('apple-touch-icon.png', makeIcon(180))
console.log('Icons generated!')
