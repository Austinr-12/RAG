"use client";

import { useState } from "react";
import { FileUpload } from "./FileUpload";
import { DocumentList } from "./DocumentList";

export function DocumentsPanel() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="space-y-8">
      <FileUpload onUploaded={() => setRefreshKey((k) => k + 1)} />
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Your documents
        </h2>
        <DocumentList refreshKey={refreshKey} />
      </section>
    </div>
  );
}
