// Editor route layout: loads the OpenCut (Tailwind v4 + shadcn) stylesheet only
// for /editor. The marketing/workspace pages keep their own globals.css.
import "./editor.css";

export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
