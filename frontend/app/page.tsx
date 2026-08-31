"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ScribeMark } from "./Logo";
import { VoiceCallModal } from "./VoiceCall";
import { ToastStack, type ToastItem, type ToastType } from "./Toast";
import { API_BASE } from "./lib/api";
import { useDemoSession } from "./hooks/useDemoSession";
import { useCustomModels } from "./hooks/useCustomModels";
import { useGenerationSettings } from "./hooks/useGenerationSettings";
import { useDocuments } from "./hooks/useDocuments";
import { useChat } from "./hooks/useChat";
import { useDrawer } from "./components/useDrawer";
import { Landing } from "./components/landing/Landing";
import { DocumentsSidebar } from "./components/personal/DocumentsSidebar";
import { ChatPanel } from "./components/personal/ChatPanel";
import { SourceViewer } from "./components/personal/SourceViewer";
import { DocumentEditorModal } from "./components/personal/DocumentEditorModal";
import { PasteModal } from "./components/personal/PasteModal";
import { SettingsPanel } from "./components/personal/SettingsPanel";

export default function Home() {
  // ---- Toasts ---------------------------------------------------------------
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const notify = useCallback((message: string, type: ToastType = "error") => {
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ---- Session / keys -------------------------------------------------------
  const demoSession = useDemoSession({ notify });
  const customModels = useCustomModels();
  const generation = useGenerationSettings();

  // ---- Mount gate (SSR hydration) ------------------------------------------
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Persist voice-call open state across reloads / shareable link param.
  const [voiceCallOpen, setVoiceCallOpen] = useState(false);
  const handleOpenVoiceCall = useCallback(() => {
    setVoiceCallOpen(true);
    try {
      sessionStorage.setItem("voice_call_open", "true");
      const url = new URL(window.location.href);
      url.searchParams.set("voice", "true");
      window.history.replaceState({}, "", url.toString());
    } catch {
      /* ignore */
    }
  }, []);
  const handleCloseVoiceCall = useCallback(() => {
    setVoiceCallOpen(false);
    try {
      sessionStorage.removeItem("voice_call_open");
      const url = new URL(window.location.href);
      url.searchParams.delete("voice");
      window.history.replaceState({}, "", url.toString());
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    if (!mounted) return;
    try {
      const params = new URLSearchParams(window.location.search);
      const isVoiceParam = params.get("voice") === "true";
      const isVoiceSaved = sessionStorage.getItem("voice_call_open") === "true";
      if (isVoiceParam || isVoiceSaved) setVoiceCallOpen(true);
    } catch {
      /* ignore */
    }
  }, [mounted]);

  // ---- Documents ------------------------------------------------------------
  const creds = {
    groqKey: demoSession.groqKey,
    sarvamKey: demoSession.sarvamKey,
    clientId: demoSession.clientId,
  };
  const sessionId = demoSession.groqKey ? `${demoSession.groqKey}:${demoSession.clientId}` : "";
  const documentsApi = useDocuments({
    creds,
    sessionId,
    enabled: mounted && demoSession.isActive,
    notify,
  });

  // ---- Chat ------------------------------------------------------------------
  const chat = useChat({
    documents: documentsApi.documents,
    generation: { topK: generation.topK, temperature: generation.temperature, maxTokens: generation.maxTokens },
    model: { selectedModel: customModels.selectedModel, activeCustomModel: customModels.activeCustomModel },
    creds,
    isDemoSession: Boolean(demoSession.groqKey),
    notify,
  });

  // Keep chat & documents in sync when the session identity changes.
  const handleSessionReset = useCallback(() => {
    chat.startNewConversation();
    documentsApi.clearLibrary();
    chat.setViewingSource(null);
  }, [chat.startNewConversation, documentsApi.clearLibrary, chat.setViewingSource]); // eslint-disable-line react-hooks/exhaustive-deps

  // When keys are cleared (End session), wipe transcript + library immediately.
  const handleEndSession = useCallback(() => {
    demoSession.end();
    chat.startNewConversation();
    documentsApi.clearLibrary();
    chat.setViewingSource(null);
  }, [demoSession.end, chat.startNewConversation, documentsApi.clearLibrary, chat.setViewingSource]); // eslint-disable-line react-hooks/exhaustive-deps

  // Switching keys mid-session should also reset the conversation.
  const handleSwitchPairReset = useCallback(
    (pair: Parameters<typeof demoSession.switchPair>[0]) => {
      demoSession.switchPair(pair);
      chat.startNewConversation();
      documentsApi.clearLibrary();
      chat.setViewingSource(null);
    },
    [demoSession.switchPair, chat.startNewConversation, documentsApi.clearLibrary, chat.setViewingSource] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ---- UI chrome state -------------------------------------------------------
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [questionIndexOpen, setQuestionIndexOpen] = useState(false);

  useDrawer({ open: sidebarOpen, onClose: () => setSidebarOpen(false), panelRef: sidebarRef });

  // New chat also closes the mobile drawer.
  const handleNewChat = useCallback(() => {
    chat.startNewConversation();
    setSidebarOpen(false);
  }, [chat.startNewConversation]);

  // ---- Early returns (loading / gate) ---------------------------------------
  if (!mounted) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: "var(--claude-bg)" }}>
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{ background: "linear-gradient(145deg, var(--claude-accent), var(--claude-accent-hover))", opacity: 0.85 }}
        >
          <ScribeMark className="w-[18px] h-[18px] text-white" />
        </div>
      </div>
    );
  }

  if (!demoSession.groqKey) {
    return (
      <>
        <Landing
          keyHistory={demoSession.keyHistory}
          onStart={(g, s) => demoSession.start(g, s)}
          onSelectPair={handleSwitchPairReset}
          onForgetPair={demoSession.forgetPair}
        />
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  return (
    <div className="flex overflow-hidden" style={{ background: "var(--claude-bg)", height: "100dvh" }}>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 md:hidden ds-animate-fade"
          style={{ background: "rgba(20, 20, 18, 0.35)", backdropFilter: "blur(2px)" }}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <DocumentsSidebar
        sidebarRef={sidebarRef}
        sidebarOpen={sidebarOpen}
        documents={documentsApi.documents}
        pendingUploads={documentsApi.pendingUploads}
        nowTick={documentsApi.nowTick}
        uploading={documentsApi.uploading}
        uploadError={documentsApi.uploadError}
        isDemoSession={Boolean(demoSession.groqKey)}
        tenantId="default"
        onNewChat={handleNewChat}
        onUploadFiles={documentsApi.uploadFiles}
        onPasteOpen={() => setPasteOpen(true)}
        onDeleteDocument={documentsApi.deleteDocument}
        onToggleDocument={documentsApi.toggleDocumentSelected}
        onOpenDocument={documentsApi.openDocument}
        onEndSession={handleEndSession}
      />

      <ChatPanel
        documentsLength={documentsApi.documents.length}
        messages={chat.messages}
        streaming={chat.streaming}
        isLoading={chat.isLoading}
        input={chat.input}
        setInput={chat.setInput}
        chatImages={chat.chatImages}
        dragOverComposer={chat.dragOverComposer}
        setDragOverComposer={chat.setDragOverComposer}
        showScrollBottom={chat.showScrollBottom}
        activeQuestionId={chat.activeQuestionId}
        questionIndexOpen={questionIndexOpen}
        setQuestionIndexOpen={setQuestionIndexOpen}
        setActiveQuestionId={chat.setActiveQuestionId}
        chatScrollRef={chat.chatScrollRef}
        messagesEndRef={chat.messagesEndRef}
        textareaRef={chat.textareaRef}
        chatImageInputRef={chat.chatImageInputRef}
        onSubmit={chat.handleSubmit}
        onKeyDown={chat.onKeyDown}
        onChatScroll={chat.handleChatScroll}
        onOpenSource={chat.openSource}
        onOpenVoice={handleOpenVoiceCall}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSidebar={() => setSidebarOpen(true)}
        addChatImages={chat.addChatImages}
        removeChatImage={chat.removeChatImage}
        onComposerDrop={chat.onComposerDrop}
        onComposerPaste={chat.onComposerPaste}
        hasVoiceKey={demoSession.hasVoiceKey}
      />

      <SourceViewer viewingSource={chat.viewingSource} onClose={() => chat.setViewingSource(null)} />

      <DocumentEditorModal docEditor={documentsApi.docEditor} setDocEditor={documentsApi.setDocEditor} onSave={documentsApi.saveDocumentEditor} />

      <PasteModal open={pasteOpen} onClose={() => setPasteOpen(false)} onSubmit={documentsApi.addPastedText} />

      <VoiceCallModal
        isOpen={voiceCallOpen}
        onClose={handleCloseVoiceCall}
        apiBase={API_BASE}
        userGroqKey={demoSession.groqKey || undefined}
        userSarvamKey={demoSession.sarvamKey || undefined}
        notify={notify}
        tenantId="default"
        conversationId={chat.conversationId || undefined}
        hasDocuments={documentsApi.documents.length > 0}
        selectedModel={customModels.activeCustomModel ? customModels.activeCustomModel.model : customModels.selectedModel}
        customLlmBaseUrl={customModels.activeCustomModel?.baseUrl}
        customLlmApiKey={customModels.activeCustomModel?.apiKey}
        clientId={demoSession.clientId}
        temperature={generation.temperature}
        maxTokens={generation.maxTokens}
      />

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        session={{ groqKey: demoSession.groqKey, sarvamKey: demoSession.sarvamKey, keyHistory: demoSession.keyHistory, isDemoSession: Boolean(demoSession.groqKey) }}
        sessionActions={{
          switchGroqKey: (k) => {
            demoSession.switchGroqKey(k);
            chat.startNewConversation();
            documentsApi.clearLibrary();
            chat.setViewingSource(null);
          },
          switchPair: handleSwitchPairReset,
          forgetPair: demoSession.forgetPair,
          end: handleEndSession,
          updateSarvam: demoSession.updateSarvam,
          onSessionReset: handleSessionReset,
        }}
        generation={{ topK: generation.topK, temperature: generation.temperature, maxTokens: generation.maxTokens }}
        generationActions={{ setTopK: generation.setTopK, setTemperature: generation.setTemperature, setMaxTokens: generation.setMaxTokens, reset: generation.reset }}
        models={{ selectedModel: customModels.selectedModel, customModels: customModels.customModels }}
        modelActions={{ selectModel: customModels.selectModel, addCustom: customModels.addCustom, removeCustom: customModels.removeCustom }}
        notify={notify}
      />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
