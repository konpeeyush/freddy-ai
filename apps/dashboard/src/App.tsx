import { Navigate, Route, Routes, useParams } from "react-router-dom"

import { DashboardLayout } from "@/components/dashboard-layout"
import { ConversationsLayout } from "@/modules/conversations/conversations-layout"
import { ConversationsEmptyView } from "@/modules/conversations/conversations-empty-view"
import { ConversationIdLayout } from "@/modules/conversations/conversation-id-layout"
import { ConversationIdView } from "@/modules/conversations/conversation-id-view"
import { FilesView } from "@/modules/files/files-view"

function ConversationIdRoute() {
  const { conversationId } = useParams()
  if (!conversationId) return <ConversationsEmptyView />

  return (
    <ConversationIdLayout>
      <ConversationIdView conversationId={conversationId} />
    </ConversationIdLayout>
  )
}

export function App() {
  return (
    <Routes>
      <Route element={<DashboardLayout />}>
        <Route path="/" element={<Navigate to="/conversations" replace />} />

        <Route path="/conversations" element={<ConversationsLayout />}>
          <Route index element={<ConversationsEmptyView />} />
          <Route path=":conversationId" element={<ConversationIdRoute />} />
        </Route>

        <Route path="/files" element={<FilesView />} />

        <Route path="*" element={<Navigate to="/conversations" replace />} />
      </Route>
    </Routes>
  )
}
