"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Package,
  FileText,
  QrCode,
  Plus,
  Trash2,
  Copy,
  Check,
  ExternalLink,
  AlertTriangle,
  RefreshCw,
  Ban,
  Calendar,
  Layers,
  X,
  CheckCircle2,
  Edit2,
  Eye,
} from "lucide-react";
import { OwnerShell } from "../../components/owner/OwnerShell";
import { ownerFetch, invalidateOwnerCache } from "../../lib/ownerFetch";
import { extractApiErrorMessage, formatClientError } from "../../lib/apiErrors";
import "../product-admin.css";
import ProductQrReveal from "./ProductQrReveal";

interface ProductDetail {
  product_id: string;
  name: string;
  model_number: string;
  category: string | null;
  short_description: string | null;
  description: string | null;
  support_disclaimer: string | null;
  status: string;
  is_active: boolean;
  created_at: string | null;
}

interface AssignedDoc {
  document_id: string;
  filename: string;
  file_size: number;
  chunk_count: number;
  status: string;
}

interface QrLink {
  link_id: string;
  name: string;
  label: string;
  is_active: boolean;
  active: boolean;
  scan_count: number;
  expires_at: string | null;
  created_at: string | null;
  token?: string;
  url?: string;
}

interface WorkspaceDoc {
  document_id: string;
  filename: string;
  chunk_count: number;
}

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const productId = params?.productId as string;

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [docs, setDocs] = useState<AssignedDoc[]>([]);
  const [links, setLinks] = useState<QrLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Edit Product modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editModel, setEditModel] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editDisclaimer, setEditDisclaimer] = useState("");
  const [editStatus, setEditStatus] = useState("active");
  const [savingEdit, setSavingEdit] = useState(false);

  // Link Doc modal state
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [allDocs, setAllDocs] = useState<WorkspaceDoc[]>([]);
  const [selectedDocId, setSelectedDocId] = useState("");
  const [linkingDoc, setLinkingDoc] = useState(false);

  // Generate QR modal state
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrName, setQrName] = useState("Official Packaging QR");
  const [generatingQr, setGeneratingQr] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<{ token: string; url: string } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const fetchDetails = async () => {
    if (!productId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await ownerFetch(`/api/v1/product-qr/products/${productId}`);
      if (!res.ok) {
        const errMsg = await extractApiErrorMessage(res, `Failed to load product details (${res.status})`);
        throw new Error(errMsg);
      }
      const data = await res.json();
      setProduct(data.product);
      setDocs(data.documents || []);
      setLinks(data.links || []);

      // Populate edit form
      setEditName(data.product.name);
      setEditModel(data.product.model_number);
      setEditCategory(data.product.category || "");
      setEditDesc(data.product.short_description || data.product.description || "");
      setEditDisclaimer(data.product.support_disclaimer || "");
      setEditStatus(data.product.status || "active");
    } catch (err: any) {
      setError(formatClientError(err, "Error loading product"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetails();
  }, [productId]);

  const loadWorkspaceDocs = async () => {
    try {
      const res = await ownerFetch("/api/v1/documents");
      if (res.ok) {
        const data = await res.json();
        const available = (data.documents || []).filter(
          (d: any) => !docs.some((assigned) => assigned.document_id === d.document_id)
        );
        setAllDocs(available);
        if (available.length > 0) setSelectedDocId(available[0].document_id);
      }
    } catch (e) {
      console.error("Failed to load workspace documents", e);
    }
  };

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingEdit(true);
    setActionError(null);
    try {
      const res = await ownerFetch(`/api/v1/product-qr/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          model_number: editModel.trim(),
          category: editCategory.trim() || null,
          short_description: editDesc.trim() || null,
          support_disclaimer: editDisclaimer.trim() || null,
          status: editStatus,
        }),
      });
      if (!res.ok) {
        const errMsg = await extractApiErrorMessage(res, "Failed to update product");
        throw new Error(errMsg);
      }
      invalidateOwnerCache("/api/v1/product-qr");
      setEditModalOpen(false);
      await fetchDetails();
    } catch (err: any) {
      setActionError(formatClientError(err, "Error updating product"));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleLinkDocument = async () => {
    if (!selectedDocId) return;
    setLinkingDoc(true);
    setActionError(null);
    try {
      const res = await ownerFetch(`/api/v1/product-qr/products/${productId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: selectedDocId }),
      });
      if (!res.ok) {
        const errMsg = await extractApiErrorMessage(res, "Failed to link document");
        throw new Error(errMsg);
      }
      invalidateOwnerCache("/api/v1/product-qr");
      setDocModalOpen(false);
      await fetchDetails();
    } catch (err: any) {
      setActionError(formatClientError(err, "Error linking document"));
    } finally {
      setLinkingDoc(false);
    }
  };

  const handleUnlinkDocument = async (docId: string) => {
    if (!confirm("Remove this document from this product? The assistant will no longer use it for queries.")) return;
    setActionError(null);
    try {
      const res = await ownerFetch(`/api/v1/product-qr/products/${productId}/documents/${docId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const errMsg = await extractApiErrorMessage(res, "Failed to unlink document");
        throw new Error(errMsg);
      }
      invalidateOwnerCache("/api/v1/product-qr");
      await fetchDetails();
    } catch (err: any) {
      setActionError(formatClientError(err, "Error unlinking document"));
    }
  };

  const handleGenerateQr = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneratingQr(true);
    setActionError(null);
    try {
      const res = await ownerFetch(`/api/v1/product-qr/products/${productId}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: qrName.trim() || "Product Support QR" }),
      });
      if (!res.ok) {
        const errMsg = await extractApiErrorMessage(res, "Failed to generate QR link");
        throw new Error(errMsg);
      }
      const data = await res.json();
      invalidateOwnerCache("/api/v1/product-qr");
      setGeneratedLink({
        token: data.link.token,
        url: data.link.url,
      });
      await fetchDetails();
    } catch (err: any) {
      setActionError(formatClientError(err, "Error generating QR link"));
    } finally {
      setGeneratingQr(false);
    }
  };

  const handleRevoke = async (linkId: string) => {
    if (!confirm("Revoking this QR link will immediately block any new visitor sessions. Proceed?")) return;
    setActionError(null);
    try {
      const res = await ownerFetch(`/api/v1/product-qr/links/${linkId}/revoke`, {
        method: "POST",
      });
      if (!res.ok) {
        const errMsg = await extractApiErrorMessage(res, "Failed to revoke link");
        throw new Error(errMsg);
      }
      invalidateOwnerCache("/api/v1/product-qr");
      await fetchDetails();
    } catch (err: any) {
      setActionError(formatClientError(err, "Error revoking link"));
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  if (loading) {
    return (
      <OwnerShell>
        <div className="product-admin-page p-8 max-w-5xl mx-auto space-y-6">
          <div className="h-8 w-48 bg-white/10 rounded-xl animate-pulse" />
          <div className="h-44 bg-white/5 rounded-2xl animate-pulse" />
        </div>
      </OwnerShell>
    );
  }

  if (error || !product) {
    return (
      <OwnerShell>
        <div className="product-admin-page p-8 max-w-xl mx-auto text-center space-y-4">
          <AlertTriangle className="w-10 h-10 mx-auto text-amber-400" />
          <h2 className="text-lg font-semibold text-white">Product Not Found</h2>
          <p className="text-sm text-neutral-400">{error || "Unable to find the requested product."}</p>
          <Link
            href="/products"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 text-white text-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Products
          </Link>
        </div>
      </OwnerShell>
    );
  }

  return (
    <OwnerShell>
      <div className="product-admin-page p-6 max-w-5xl mx-auto space-y-8">
        {actionError && (
          <div className="p-3.5 rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 text-sm flex items-center justify-between">
            <span>{actionError}</span>
            <button type="button" onClick={() => setActionError(null)} className="text-red-300 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-sm text-neutral-400">
            <Link href="/products" className="hover:text-white flex items-center gap-1 transition">
              <ArrowLeft className="w-4 h-4" /> Products
            </Link>
            <span>/</span>
            <span className="text-white font-medium">{product.name}</span>
          </div>

          <button
            onClick={() => setEditModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-medium transition shadow-sm"
          >
            <Edit2 className="w-3.5 h-3.5" />
            Edit SKU
          </button>
        </div>

        {/* Product Overview Card */}
        <div className="p-6 rounded-2xl bg-white/5 border border-white/10 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-md bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  {product.model_number}
                </span>
                <span className="text-xs text-neutral-400">{product.category || "General"}</span>
              </div>
              <h1 className="text-2xl font-bold text-white mt-1.5">{product.name}</h1>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full border self-start sm:self-auto capitalize ${
                product.status === "active"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : product.status === "draft"
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  : "bg-neutral-500/10 text-neutral-400 border-neutral-500/20"
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {product.status || "active"}
            </span>
          </div>

          <p className="text-sm text-neutral-300">
            {product.short_description || product.description || "No description provided for this product."}
          </p>

          {product.support_disclaimer && (
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 text-xs text-neutral-400">
              <span className="text-neutral-300 font-medium">Support Disclaimer: </span>
              {product.support_disclaimer}
            </div>
          )}
        </div>

        {/* Section: Linked Support Manuals */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <FileText className="w-5 h-5 text-sky-400" />
                Assigned Product Documentation
              </h2>
              <p className="text-xs text-neutral-400 mt-0.5">
                The product AI answers customer queries strictly using chunks from these assigned documents.
              </p>
            </div>
            <button
              onClick={() => {
                loadWorkspaceDocs();
                setDocModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-medium transition shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              Assign Manual
            </button>
          </div>

          {docs.length === 0 ? (
            <div className="p-8 rounded-xl border border-dashed border-white/10 text-center space-y-2">
              <FileText className="w-8 h-8 mx-auto text-neutral-500" />
              <p className="text-sm text-neutral-300 font-medium">No manuals assigned yet</p>
              <p className="text-xs text-neutral-400 max-w-sm mx-auto">
                Assign an uploaded user manual, troubleshooting guide, or warranty policy so the assistant can answer customer questions.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {docs.map((d) => (
                <div
                  key={d.document_id}
                  className="p-4 rounded-xl bg-white/5 border border-white/10 flex items-start justify-between gap-3"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <FileText className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{d.filename}</p>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        {d.chunk_count} indexed chunks • {(d.file_size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleUnlinkDocument(d.document_id)}
                    title="Unlink document"
                    className="p-1.5 text-neutral-400 hover:text-red-400 rounded-lg hover:bg-red-500/10 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Section: QR Access Links */}
        <div className="space-y-4 pt-4 border-t border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <QrCode className="w-5 h-5 text-sky-400" />
                Product QR Support Links
              </h2>
              <p className="text-xs text-neutral-400 mt-0.5">
                Generate shareable or printable URLs and QR codes for packaging, user manuals, and warranty cards.
              </p>
            </div>
            <button
              onClick={() => {
                setGeneratedLink(null);
                setQrModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-medium transition shadow-md shadow-sky-500/20"
            >
              <Plus className="w-3.5 h-3.5" />
              Generate QR Link
            </button>
          </div>

          {links.length === 0 ? (
            <div className="p-8 rounded-xl border border-dashed border-white/10 text-center space-y-2">
              <QrCode className="w-8 h-8 mx-auto text-neutral-500" />
              <p className="text-sm text-neutral-300 font-medium">No QR links generated</p>
              <p className="text-xs text-neutral-400 max-w-sm mx-auto">
                Generate a QR access token to test consumer troubleshooting or print onto product packaging.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {links.map((link) => (
                <div
                  key={link.link_id}
                  className="p-4 rounded-xl bg-white/5 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{link.label || link.name}</span>
                      <span
                        className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                          link.is_active
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "bg-red-500/10 text-red-400 border-red-500/20"
                        }`}
                      >
                        {link.is_active ? "Active" : "Revoked"}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-400">
                      {link.scan_count} consumer visits • Created {new Date(link.created_at || "").toLocaleDateString()}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {link.is_active && (
                      <button
                        onClick={() => handleRevoke(link.link_id)}
                        className="px-3 py-1.5 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 text-xs transition"
                      >
                        Revoke Link
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal: Edit Product SKU */}
        {editModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <div className="product-admin-dialog bg-neutral-900 border border-white/15 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <Edit2 className="w-5 h-5 text-sky-400" />
                  Edit Product SKU
                </h3>
                <button onClick={() => setEditModalOpen(false)} className="text-neutral-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleEditSave} className="space-y-4 text-sm">
                <div>
                  <label className="block text-xs font-medium text-neutral-300 mb-1">Product Title</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-neutral-300 mb-1">Model / SKU #</label>
                    <input
                      type="text"
                      required
                      value={editModel}
                      onChange={(e) => setEditModel(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-300 mb-1">Status</label>
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-sky-500"
                    >
                      <option value="active" className="bg-neutral-900">Active</option>
                      <option value="draft" className="bg-neutral-900">Draft</option>
                      <option value="archived" className="bg-neutral-900">Archived</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-300 mb-1">Short Description</label>
                  <textarea
                    rows={2}
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-sky-500 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-300 mb-1">Support Disclaimer</label>
                  <input
                    type="text"
                    value={editDisclaimer}
                    onChange={(e) => setEditDisclaimer(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
                  <button
                    type="button"
                    onClick={() => setEditModalOpen(false)}
                    className="px-3.5 py-1.5 rounded-xl text-neutral-300 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingEdit}
                    className="px-4 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-medium transition"
                  >
                    {savingEdit ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Link Document */}
        {docModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <div className="product-admin-dialog bg-neutral-900 border border-white/15 rounded-2xl w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto p-5 shadow-2xl space-y-3">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <FileText className="w-5 h-5 text-sky-400" />
                  Assign Workspace Manual
                </h3>
                <button onClick={() => setDocModalOpen(false)} className="text-neutral-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {allDocs.length === 0 ? (
                <div className="py-6 text-center text-xs text-neutral-400 space-y-2">
                  <p>No unassigned documents found in workspace.</p>
                  <p>Upload your product manual in the Assistant / Knowledge section first.</p>
                </div>
              ) : (
                <div className="space-y-4 text-sm">
                  <div>
                    <label className="block text-xs font-medium text-neutral-300 mb-1">
                      Select Document
                    </label>
                    <select
                      value={selectedDocId}
                      onChange={(e) => setSelectedDocId(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-sky-500"
                    >
                      {allDocs.map((d) => (
                        <option key={d.document_id} value={d.document_id} className="bg-neutral-900 text-white">
                          {d.filename} ({d.chunk_count} chunks)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
                    <button
                      type="button"
                      onClick={() => setDocModalOpen(false)}
                      className="px-3.5 py-1.5 rounded-xl text-neutral-300 text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={linkingDoc}
                      onClick={handleLinkDocument}
                      className="px-4 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-medium transition"
                    >
                      {linkingDoc ? "Linking..." : "Assign Document"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Modal: Generate QR Link */}
        {qrModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <div className="product-admin-dialog bg-neutral-900 border border-white/15 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <QrCode className="w-5 h-5 text-sky-400" />
                  Generate QR Support Link
                </h3>
                <button onClick={() => setQrModalOpen(false)} className="text-neutral-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {!generatedLink ? (
                <form onSubmit={handleGenerateQr} className="space-y-4 text-sm">
                  <div>
                    <label className="block text-xs font-medium text-neutral-300 mb-1">
                      Link Label / Placement *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Unit Packaging QR Batch 1"
                      value={qrName}
                      onChange={(e) => setQrName(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-neutral-500 text-sm focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  <p className="text-xs text-neutral-400 leading-relaxed">
                    This link can be scanned simultaneously by any number of customers without locking their devices.
                  </p>
                  <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
                    <button
                      type="button"
                      onClick={() => setQrModalOpen(false)}
                      className="px-3.5 py-1.5 rounded-xl text-neutral-300 text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={generatingQr}
                      className="px-4 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-medium transition"
                    >
                      {generatingQr ? "Generating..." : "Create Link"}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-3 text-center">
                  <ProductQrReveal
                    productName={product.name}
                    modelNumber={product.model_number}
                    supportUrl={`${window.location.origin}${generatedLink.url}`}
                  />

                  <div className="p-3 rounded-xl bg-black/40 border border-white/10 flex items-center justify-between gap-2 text-left">
                    <code className="text-xs text-sky-400 truncate select-all">
                      {window.location.origin}{generatedLink.url}
                    </code>
                    <button
                      onClick={() => copyToClipboard(`${window.location.origin}${generatedLink.url}`)}
                      className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white shrink-0 transition"
                      title="Copy URL"
                    >
                      {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>

                  <div className="flex flex-wrap justify-center gap-2 pt-1">
                    <a
                      href={generatedLink.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-medium transition"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Preview Public Page
                    </a>
                    <button
                      onClick={() => setQrModalOpen(false)}
                      className="px-4 py-2 rounded-xl bg-white/10 text-white text-xs font-medium transition"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </OwnerShell>
  );
}
