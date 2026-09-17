"use client";

import { useRef, useState } from "react";
import { ArrowRight, FileText, Upload, X } from "lucide-react";
import { UploadedFile } from "@/lib/types";

export default function ExtratosStep({
  files,
  onFilesChange,
  onBack,
  onNext,
  onSkipManual,
}: {
  files: UploadedFile[];
  onFilesChange: (files: UploadedFile[]) => void;
  onBack: () => void;
  onNext: () => void;
  onSkipManual: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next: UploadedFile[] = Array.from(list).map((file) => ({
      id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
      file,
      institutionGuess: "",
      status: "pronto",
    }));
    onFilesChange([...files, ...next]);
  }

  function removeFile(id: string) {
    onFilesChange(files.filter((f) => f.id !== id));
  }

  function updateInstitution(id: string, value: string) {
    onFilesChange(files.map((f) => (f.id === id ? { ...f, institutionGuess: value } : f)));
  }

  return (
    <div className="px-16 py-24">
      <div className="max-w-[840px]">
        <h1 className="font-serif font-extrabold tracking-tight text-3xl mb-2.5">Envie seus extratos</h1>
        <p className="text-[15px] text-aligna-muted leading-relaxed mb-9 max-w-[600px]">
          Envie quantos extratos quiser, de qualquer banco, corretora ou plataforma — inclusive de crédito privado. Não é
          preciso conectar sua conta em lugar nenhum.
        </p>

        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
          className="mb-7 flex cursor-pointer flex-col items-center rounded-xl border-[1.5px] border-dashed p-12 text-center transition-colors"
          style={{ borderColor: dragOver ? "#1c8a4f" : "#dcece1", background: dragOver ? "#d9f5e2" : "#ffffff" }}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg"
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
          <div className="mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-aligna-pale text-aligna-mid">
            <Upload size={26} />
          </div>
          <div className="text-[15px] font-semibold mb-1">Arraste os arquivos aqui, ou clique para selecionar</div>
          <div className="text-[13px] text-aligna-muted">PDF, PNG ou JPG — até 20MB por arquivo</div>
        </div>

        {files.length > 0 && (
          <>
            <div className="mb-3.5 text-xs font-semibold uppercase tracking-wide text-aligna-muted">
              {files.length} arquivo{files.length > 1 ? "s" : ""} enviado{files.length > 1 ? "s" : ""}
            </div>
            <div className="mb-9 flex flex-col gap-2.5">
              {files.map((f) => (
                <div key={f.id} className="flex items-center gap-3.5 rounded-md border border-aligna-line bg-aligna-card px-4 py-3.5">
                  <FileText size={20} className="text-aligna-muted shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{f.file.name}</div>
                    <div className="text-xs text-aligna-muted">{(f.file.size / 1024).toFixed(0)} KB</div>
                  </div>
                  <input
                    className="input w-48 py-1.5 text-xs"
                    placeholder="De qual instituição é?"
                    value={f.institutionGuess}
                    onChange={(e) => updateInstitution(f.id, e.target.value)}
                  />
                  <button onClick={() => removeFile(f.id)} className="shrink-0 text-aligna-muted hover:text-aligna-danger">
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="flex items-center justify-between">
          <button className="text-sm font-medium text-aligna-muted" onClick={onBack}>
            ← Voltar
          </button>
          <div className="flex items-center gap-5">
            <button className="text-sm font-medium text-aligna-mid" onClick={onSkipManual}>
              Prefiro adicionar meus ativos manualmente
            </button>
            <button className="btn-primary" disabled={files.length === 0} onClick={onNext}>
              Continuar
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
