import { useEffect, useRef, useState } from "react";
import "@google/model-viewer";
import { Select } from "./ui";

type Viewer = HTMLElement & {
  availableAnimations?: string[];
  play?: (options?: { repetitions?: number }) => void;
  pause?: () => void;
};

export function ModelPreview({
  src,
  alt = "3D 模型",
  className = "",
  showClipSelect = true,
  defaultClip,
}: {
  src: string;
  alt?: string;
  className?: string;
  showClipSelect?: boolean;
  defaultClip?: string;
}) {
  const ref = useRef<Viewer | null>(null);
  const [clips, setClips] = useState<string[]>([]);
  const [clip, setClip] = useState(defaultClip || "");

  useEffect(() => {
    setClips([]);
    setClip(defaultClip || "");
  }, [src, defaultClip]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onLoad = () => {
      const names = Array.from(el.availableAnimations || []);
      setClips(names);
      setClip((cur) => {
        if (cur && names.includes(cur)) return cur;
        if (defaultClip && names.includes(defaultClip)) return defaultClip;
        return names[0] || "";
      });
    };
    el.addEventListener("load", onLoad);
    return () => el.removeEventListener("load", onLoad);
  }, [src, defaultClip]);

  return (
    <div className={`relative overflow-hidden bg-ink-2 ${className}`}>
      <model-viewer
        ref={ref as never}
        src={src}
        alt={alt}
        camera-controls
        autoplay
        loading="lazy"
        touch-action="pan-y"
        shadow-intensity="1"
        interaction-prompt="none"
        animation-name={clip || undefined}
        className="size-full"
        style={{ width: "100%", height: "100%", background: "transparent" }}
      />
      {showClipSelect && clips.length > 0 ? (
        <div className="absolute bottom-2 left-2 right-2">
          <Select value={clip} onChange={(e) => setClip(e.target.value)} className="bg-ink/90 py-1.5 text-xs">
            {clips.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
    </div>
  );
}
