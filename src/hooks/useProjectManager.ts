import { useState, useCallback, useEffect } from "react";
import type { Project } from "../types";

export function useProjectManager() {
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    window.claude.projects.list().then(setProjects);
  }, []);

  const createProject = useCallback(async (spaceId?: string) => {
    const project = await window.claude.projects.create(spaceId);
    if (!project) return null;
    setProjects((prev) => {
      if (prev.some((p) => p.id === project.id)) return prev;
      return [...prev, project];
    });
    return project;
  }, []);

  const createDevProject = useCallback(async (name: string, spaceId?: string) => {
    const project = await window.claude.projects.createDev(name, spaceId);
    if (!project) return null;
    setProjects((prev) => {
      if (prev.some((p) => p.id === project.id)) return prev;
      return [...prev, project];
    });
    return project;
  }, []);

  /**
   * Non-interactive project creation — takes a filesystem path directly
   * instead of prompting via the system directory picker. Returns the existing
   * project if one already tracks the same path. Used by the "import session
   * by id" flow where cwd is discovered from the session file.
   */
  const createProjectAtPath = useCallback(
    async (folderPath: string, spaceId?: string): Promise<{ project: Project; created: boolean } | { error: string }> => {
      const result = await window.claude.projects.createAtPath(folderPath, spaceId);
      if ("error" in result) return result;
      setProjects((prev) => {
        if (prev.some((p) => p.id === result.project.id)) return prev;
        return [...prev, result.project];
      });
      return result;
    },
    [],
  );

  const deleteProject = useCallback(async (id: string) => {
    await window.claude.projects.delete(id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const renameProject = useCallback(async (id: string, name: string) => {
    await window.claude.projects.rename(id, name);
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name } : p)),
    );
  }, []);

  const updateProjectSpace = useCallback(async (id: string, spaceId: string) => {
    await window.claude.projects.updateSpace(id, spaceId);
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, spaceId } : p)),
    );
  }, []);

  const updateProjectIcon = useCallback(async (id: string, icon: string | null, iconType: "emoji" | "lucide" | "simple" | null) => {
    await window.claude.projects.updateIcon(id, icon, iconType);
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        if (icon === null || iconType === null) {
          const { icon: _i, iconType: _t, ...rest } = p;
          return rest;
        }
        return { ...p, icon, iconType };
      }),
    );
  }, []);

  const reorderProject = useCallback(async (projectId: string, targetProjectId: string) => {
    await window.claude.projects.reorder(projectId, targetProjectId);
    setProjects((prev) => {
      const next = [...prev];
      const fromIdx = next.findIndex((p) => p.id === projectId);
      const toIdx = next.findIndex((p) => p.id === targetProjectId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }, []);

  return {
    projects,
    createProject,
    createProjectAtPath,
    createDevProject,
    deleteProject,
    renameProject,
    updateProjectSpace,
    updateProjectIcon,
    reorderProject,
  };
}
