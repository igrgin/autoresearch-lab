- **Functionality: 9.2/10.** Creating, finding and reopening projects are clearly supported. The single required name keeps creation approachable, search and sorting are easy to locate, and explicit Open buttons avoid ambiguous row behavior. The reopened state is especially clear: the selected row and detail panel both identify the current project.

- **Appearance: 9.0/10.** Strong hierarchy, restrained colors, readable typography and consistent controls make this feel cohesive and polished. The two-panel layout preserves context well. Remaining refinements concern metadata density and vertical space.

Specific observed issues, ordered by importance:

1. **The reopened-project panel extends below the visible viewport.** “Project ID & Git path” sits against the bottom edge, with further content requiring scrolling. Tighten the panel’s vertical spacing or group secondary repository details into a compact disclosure so the project overview fits more comfortably.

2. **Saved-project metadata feels crowded horizontally.** Folder identifiers, path links and exact opening times compete across the lower portion of each card. Give recency a consistent separate line or column, with the folder identifier and path action grouped together.

3. **Long parent paths require effort to read.** Wrapping preserves the full value but spreads it across several lines inside a narrow box. Consider emphasizing the final parent directory and placing the full selectable path in the existing path inspection view.

4. **Path-action wording varies slightly between contexts.** “Show full project path” in creation becomes “Show full path” in the current-project panel. Use the explicit wording consistently to reinforce that both controls reveal the complete project location.
