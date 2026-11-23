"use client";

import { useEffect, useRef, useState } from "react";
import type { DesignLayer, DesignProject } from "@/server/design";

function drawText(context: CanvasRenderingContext2D, layer: DesignLayer, fontSize: number, content: string) {
  context.save();
  context.beginPath();
  context.rect(layer.x, layer.y, layer.width, layer.height);
  context.clip();
  context.font = `${fontSize}px sans-serif`;
  context.textBaseline = "top";
  const lines: string[] = [];
  let current = "";
  for (const word of content.split(/\s+/u)) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && context.measureText(candidate).width > layer.width) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  for (const [index, line] of lines.entries()) {
    const y = layer.y + index * fontSize * 1.2;
    if (y >= layer.y + layer.height) break;
    context.fillText(line, layer.x, y, layer.width);
  }
  context.restore();
}

export function DesignPreview({ project }: { project: DesignProject & { layers: DesignLayer[] } }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.fillStyle = project.background;
    context.fillRect(0, 0, project.width, project.height);
    for (const layer of project.layers) {
      context.fillStyle = layer.color;
      if (layer.kind === "rectangle") context.fillRect(layer.x, layer.y, layer.width, layer.height);
      else if (layer.content && layer.font_size) drawText(context, layer, layer.font_size, layer.content);
    }
  }, [project]);

  function download() {
    const element = canvas.current;
    if (!element?.getContext("2d")) {
      setMessage("Canvas preview is unavailable in this browser.");
      return;
    }
    element.toBlob((blob) => {
      if (!blob) {
        setMessage("The design could not be exported.");
        return;
      }
      setMessage("");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `businessos-design-${project.id}.png`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    }, "image/png");
  }

  return <section className="panel">
    <h2>Canvas preview</h2>
    <canvas ref={canvas} width={project.width} height={project.height}
      style={{ display: "block", width: "100%", maxWidth: project.width, height: "auto", border: "1px solid var(--line)" }}
      aria-label={`Canvas preview of ${project.name}`}>
      Canvas preview is unavailable in this browser.
    </canvas>
    <button type="button" onClick={download}>Download PNG</button>
    {message && <p className="notice" role="status">{message}</p>}
  </section>;
}
