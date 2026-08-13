import { IMAGE_MODELS, type ImageModelId } from "@/lib/kyozai/image-models";

export function ImageModelPicker({ value, onChange }: { value: ImageModelId | null; onChange: (value: ImageModelId) => void }) {
  return (
    <fieldset className="model-picker">
      <legend>画像生成モデル <span>必須・生成ごとに選択</span></legend>
      {Object.entries(IMAGE_MODELS).map(([id, model]) => (
        <label key={id} className={value === id ? "selected" : ""}>
          <input type="radio" name="image-model" value={id} checked={value === id} onChange={() => onChange(id as ImageModelId)} />
          <span><strong>{model.label}</strong><small>{model.description}</small></span>
        </label>
      ))}
    </fieldset>
  );
}
