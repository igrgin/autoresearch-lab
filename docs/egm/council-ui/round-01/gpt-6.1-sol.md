- **Functionality: 7.2/10.** Creation, saved projects and individual Open controls are easy to find. “Ready to open” and the reopened-project confirmation provide clear feedback. The reopened state weakens navigation by pushing saved projects below the viewport, while the two creation fields need clearer guidance.
- **Appearance: 8.0/10.** Consistent typography, restrained colors, aligned controls and clear section headings make this feel orderly. Oversized cards, repeated technical paths and weak action contrast reduce density and polish.

Specific issues, ordered by importance:

1. **Reopening pushes the project list out of view.** The creation form remains prominent above a large “Open project” card. Use a compact current-project summary or a dedicated project view with a clear “Back to projects” control. Label the state “Current project” or “Project opened.”
2. **“Project name” versus “Folder name” is underspecified.** Explain their relationship, provide an example and derive an editable folder name from the project name.
3. **Technical details compete with useful information.** The reopened card prominently displays a UUID and repeats lengthy filesystem paths. Prioritize the project name and readiness message; move identity and repository details into an expandable section.
4. **Saved-project cards consume excessive vertical space.** Reduce padding and use compact rows so more projects remain visible, especially after opening one.
5. **Open buttons look muted enough to suggest inactivity.** Increase their text and background contrast while keeping Create project as the primary action. Give Refresh projects a clearer button affordance.
