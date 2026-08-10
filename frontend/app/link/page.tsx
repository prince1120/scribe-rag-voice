import { redirect } from "next/navigation";

// Singular is the natural thing to type and the natural thing to say out loud,
// so it redirects rather than 404s. The plural stays canonical because the page
// lists many links.
export default function LinkAliasPage() {
  redirect("/links");
}
