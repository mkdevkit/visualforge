/// <reference types="vite/client" />

import type { ModelViewerElement } from "@google/model-viewer";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<React.HTMLAttributes<ModelViewerElement>, ModelViewerElement> & {
        src?: string;
        alt?: string;
        poster?: string;
        autoplay?: boolean | string;
        exposure?: string;
        loading?: "auto" | "lazy" | "eager";
        "camera-controls"?: boolean | string;
        "touch-action"?: string;
        "shadow-intensity"?: string;
        "animation-name"?: string;
        "interaction-prompt"?: string;
        "environment-image"?: string;
      };
    }
  }
}
