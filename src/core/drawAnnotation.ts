import type { Annotation } from "./types"

export function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  a: Annotation,
  w: number,
  h: number
) {
  const [x1n, y1n, x2n, y2n] = a.points
  const x1 = x1n * w
  const y1 = y1n * h
  const x2 = (x2n ?? x1n) * w
  const y2 = (y2n ?? y1n) * h

  ctx.save()
  ctx.strokeStyle = a.color
  ctx.fillStyle = a.color
  ctx.lineWidth = (a.strokeWidth * Math.max(w, h)) / 400
  ctx.lineCap = "round"
  ctx.lineJoin = "round"

  switch (a.tool) {
    case "line":
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      break

    case "rectangle":
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1)
      break

    case "arrow": {
      const dx = x2 - x1
      const dy = y2 - y1
      const arrowLen = Math.hypot(dx, dy)
      if (arrowLen < 0.001) break

      const ux = dx / arrowLen
      const uy = dy / arrowLen
      const px = -uy
      const py = ux

      const headLen = Math.min(Math.max(ctx.lineWidth * 4, 10), arrowLen * 0.45)
      const headWidth = Math.max(headLen * 0.65, ctx.lineWidth * 2.5)

      const baseX = x2 - ux * headLen
      const baseY = y2 - uy * headLen
      const leftX = baseX + px * (headWidth / 2)
      const leftY = baseY + py * (headWidth / 2)
      const rightX = baseX - px * (headWidth / 2)
      const rightY = baseY - py * (headWidth / 2)

      // Extend shaft slightly under the head to avoid visual gaps.
      const shaftEndX =
        baseX + ux * Math.min(ctx.lineWidth * 0.8, headLen * 0.25)
      const shaftEndY =
        baseY + uy * Math.min(ctx.lineWidth * 0.8, headLen * 0.25)

      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(shaftEndX, shaftEndY)
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(x2, y2)
      ctx.lineTo(leftX, leftY)
      ctx.lineTo(rightX, rightY)
      ctx.closePath()
      ctx.fill()
      break
    }

    case "text":
      if (a.text) {
        const fontSize = (4 * a.strokeWidth * Math.max(w, h)) / 400
        ctx.font = `${fontSize}px system-ui`
        ctx.textBaseline = "top"
        const lines = a.text.split("\n")
        lines.forEach((line, i) => ctx.fillText(line, x1, y1 + i * fontSize))
      }
      break
  }

  ctx.restore()
}
