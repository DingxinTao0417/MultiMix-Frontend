"use client";

import { useRef } from "react";
import { Plus, X } from "lucide-react";

import useDialogFocusManagement from "../lib/use-dialog-focus-management";

export type ProjectTargetOption = {
  id: string;
  title: string;
  stateLabel: string;
  updatedAt: string;
};

export default function ProjectTargetPicker({
  open,
  projects,
  submittingProjectId = null,
  onSelect,
  onClose,
  onCreateProject,
}: {
  open: boolean;
  projects: ProjectTargetOption[];
  submittingProjectId?: string | null;
  onSelect: (projectId: string) => void;
  onClose: () => void;
  onCreateProject: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useDialogFocusManagement({
    open,
    dialogRef,
    initialFocusRef: closeButtonRef,
    onEscape: onClose,
  });

  if (!open) return null;

  return (
    <div className="shadcn-prototype-project-target-mask" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="shadcn-prototype-project-target-picker"
        role="dialog"
        aria-modal="true"
        aria-label="选择目标项目"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong>加入项目</strong>
            <span>选择这份素材要加入哪个项目</span>
          </div>
          <button ref={closeButtonRef} type="button" aria-label="关闭项目选择" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        {projects.length ? (
          <ul className="shadcn-prototype-project-target-list">
            {projects.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  disabled={submittingProjectId !== null}
                  aria-label={`${project.title}，${project.stateLabel}，${project.updatedAt}`}
                  onClick={() => onSelect(project.id)}
                >
                  <strong>{project.title}</strong>
                  <span>{project.stateLabel}</span>
                  <small>{submittingProjectId === project.id ? "正在加入…" : project.updatedAt}</small>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="shadcn-prototype-project-target-empty">
            <strong>还没有可以加入的项目</strong>
            <span>先新建项目，再回来添加素材。</span>
            <button type="button" onClick={onCreateProject}>
              <Plus size={14} aria-hidden="true" />新建项目
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
