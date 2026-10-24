import { Suspense } from "react";
import MessagesScreen from "@/components/app/MessagesScreen";

export default function MessagesPage() {
  return <Suspense fallback={<main className="app-stage"><p role="status">Opening messages...</p></main>}><MessagesScreen /></Suspense>;
}
