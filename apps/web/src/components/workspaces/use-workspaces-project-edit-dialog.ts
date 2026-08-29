import { useMemo, useState } from 'react'
import type { AppState, Project } from '@shared/types'
import { api } from '../../lib/api'
import { buildProjectPayload, createEmptyProjectDraft, projectToDraft, type ProjectFormDraft } from '../../lib/project-form'

type UseWorkspacesProjectEditDialogOptions = {
  projects: Project[]
  runMutation: <T extends { state: AppState; message?: string }>(action: () => Promise<T>) => Promise<T | undefined>
}

export function useWorkspacesProjectEditDialog({
  projects,
  runMutation,
}: UseWorkspacesProjectEditDialogOptions) {
  const [projectEditOpen, setProjectEditOpen] = useState(false)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [projectDraft, setProjectDraft] = useState<ProjectFormDraft>(createEmptyProjectDraft)
  const [projectReimportBusy, setProjectReimportBusy] = useState(false)
  const editingProject = useMemo(
    () => (editingProjectId ? projects.find((project) => project.id === editingProjectId) ?? null : null),
    [editingProjectId, projects],
  )

  const handleProjectEditOpenChange = (open: boolean) => {
    setProjectEditOpen(open)
    if (!open) {
      setEditingProjectId(null)
      setProjectDraft(createEmptyProjectDraft())
    }
  }

  const handleOpenProjectEdit = (projectId: string) => {
    const project = projects.find((item) => item.id === projectId)
    if (!project) {
      return
    }

    setEditingProjectId(project.id)
    setProjectDraft(projectToDraft(project))
    setProjectEditOpen(true)
  }

  const handleSubmitProjectEdit = async () => {
    if (!editingProject || !projectDraft.name.trim()) {
      return
    }

    const response = await runMutation(() => api.updateProject(
      editingProject.id,
      buildProjectPayload(projectDraft, editingProject),
    ))
    const nextProject = response?.state.projects.find((item) => item.id === editingProject.id)
    if (nextProject) {
      setProjectDraft(projectToDraft(nextProject))
    }
  }

  const handleReimportProjectEnvironmentTemplate = async () => {
    if (!editingProject) {
      return
    }

    setProjectReimportBusy(true)
    try {
      const response = await runMutation(() => api.importProjectEnvironmentTemplate(editingProject.id))
      const nextProject = response?.state.projects.find((item) => item.id === editingProject.id)
      if (nextProject) {
        setProjectDraft(projectToDraft(nextProject))
      }
    } finally {
      setProjectReimportBusy(false)
    }
  }

  const handleSyncProjectSettings = async (executorId?: string) => {
    if (!editingProject) {
      return
    }

    setProjectReimportBusy(true)
    try {
      const response = await runMutation(() => api.syncProjectSettings(editingProject.id, { executorId }))
      const nextProject = response?.state.projects.find((item) => item.id === editingProject.id)
      if (nextProject) {
        setProjectDraft(projectToDraft(nextProject))
      }
    } finally {
      setProjectReimportBusy(false)
    }
  }

  return {
    editingProject,
    handleOpenProjectEdit,
    handleProjectEditOpenChange,
    handleReimportProjectEnvironmentTemplate,
    handleSyncProjectSettings,
    handleSubmitProjectEdit,
    projectDraft,
    projectEditOpen,
    projectReimportBusy,
    setProjectDraft,
  }
}
