import React from "react";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="shrink-0 whitespace-nowrap text-[11px] tracking-[0.18em] uppercase text-brass">{label}</span>
        {hint ? <span className="min-w-0 text-xs leading-relaxed text-mute">{hint}</span> : null}
      </div>
      {children}
    </label>
  );
}

const control =
  "w-full rounded-xl border border-line bg-ink-2/80 px-3 py-2.5 text-sm text-foam outline-none transition focus:border-brass/70";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${control} ${props.className || ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${control} ${props.className || ""}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${control} min-h-32 resize-y leading-relaxed ${props.className || ""}`} />;
}

export function Button({
  tone = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "ghost" | "danger" }) {
  const map = {
    primary:
      "bg-linear-to-br from-ember to-[#a83a16] text-foam shadow-[0_8px_24px_rgba(226,91,44,0.25)] hover:brightness-110",
    ghost: "border border-line bg-panel text-foam hover:border-brass/50",
    danger: "border border-red-900/60 bg-red-950/40 text-red-200 hover:bg-red-950/70",
  };
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-50 ${map[tone]} ${className}`}
    />
  );
}

export function Dropzone({
  accept,
  label,
  onPicked,
  files,
  multiple = true,
}: {
  accept: string;
  label: string;
  onPicked: (files: File[]) => void;
  files: File[];
  multiple?: boolean;
}) {
  return (
    <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-ink-2/50 px-4 py-8 text-center hover:border-brass/50">
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => onPicked(Array.from(e.target.files || []))}
      />
      <span className="text-sm text-foam">{label}</span>
      <span className="mt-1 text-xs text-mute">
        {files.length ? files.map((f) => f.name).join("、") : "点击或拖入本地文件"}
      </span>
    </label>
  );
}

export function ErrorBox({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <div className="rounded-xl border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-all text-red-200">
      {error}
    </div>
  );
}

export function Spinner({ label, tone = "comfy" }: { label: string; tone?: "comfy" | "qwen" }) {
  const color = tone === "qwen" ? "border-qwen/20 border-t-qwen text-qwen" : "border-brass/20 border-t-brass text-brass";
  return (
    <div className={`flex items-center gap-3 text-sm ${tone === "qwen" ? "text-qwen" : "text-brass"}`}>
      <span className={`size-4 animate-spin rounded-full border-2 ${color}`} />
      {label}
    </div>
  );
}
