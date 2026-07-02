import type { translations } from "./translations"

type HomeT = (typeof translations)["en"]["home"]

/**
 * Workspace names are data, but today every name is system-generated in
 * English ("My Workspace" from the 010 backfill, "<local-part>'s Workspace"
 * at registration). Localize those known patterns at display time; anything
 * else (future user-chosen names) passes through untouched.
 */
export function displayWorkspaceName(name: string, t: HomeT): string {
  if (name === "My Workspace") return t.defaultWorkspaceName
  const match = name.match(/^(.+)'s Workspace$/)
  if (match) return t.userWorkspaceName.replace("{name}", match[1])
  return name
}
