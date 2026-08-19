import { useEffect } from "react";
import type { FeatureId } from "../lib/types";
import { pickDefaultWorkflow, stationWorkflows, useCatalog } from "../lib/catalog";
import { Field, Select } from "./ui";

export function WorkflowSelect({
  feature,
  value,
  onChange,
}: {
  feature: FeatureId;
  value: string;
  onChange: (id: string) => void;
}) {
  const catalog = useCatalog();
  const list = stationWorkflows(catalog, feature);

  useEffect(() => {
    const next = pickDefaultWorkflow(catalog, feature, value);
    if (next && next !== value) onChange(next);
  }, [catalog, feature, value]);

  if (catalog.loadError) return null;
  if (!list.length) {
    return (
      <p className="text-xs leading-relaxed text-mute">
        该工位还没有生效工作流。请到 ComfyManager「工作流」页加入并勾选生效。
      </p>
    );
  }

  return (
    <Field label="工作流" hint="与模型独立，图内需 {{model}} 才能换主模型">
      <Select value={value || list[0]?.id || ""} onChange={(e) => onChange(e.target.value)}>
        {list.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}
