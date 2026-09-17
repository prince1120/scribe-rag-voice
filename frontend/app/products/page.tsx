"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Package,
  Plus,
  QrCode,
  Search,
  ExternalLink,
  FileText,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  X,
  Layers,
  Link2,
} from "lucide-react";
import { OwnerShell } from "../components/owner/OwnerShell";
import { ownerFetch, invalidateOwnerCache } from "../lib/ownerFetch";
import { extractApiErrorMessage, formatClientError } from "../lib/apiErrors";
import "./product-admin.css";

interface Product {
  product_id: string;
  name: string;
  model_number: string;
  category: string | null;
  short_description: string | null;
  description: string | null;
  support_disclaimer: string | null;
  status: string;
  is_active: boolean;
  assigned_documents_count?: number;
  active_links_count?: number;
  created_at: string | null;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  // Form states
  const [name, setName] = useState("");
  const [modelNumber, setModelNumber] = useState("");
  const [category, setCategory] = useState("Appliances");
  const [description, setDescription] = useState("");
  const [supportDisclaimer, setSupportDisclaimer] = useState("");
  const [status, setStatus] = useState("active");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchProducts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ownerFetch("/api/v1/product-qr/products");
      if (res.status === 404) {
        setError("Product QR feature is currently disabled (PRODUCT_QR_ENABLED=false).");
        return;
      }
      if (!res.ok) {
        const errMsg = await extractApiErrorMessage(res, `Failed to load products (${res.status})`);
        throw new Error(errMsg);
      }
      const data = await res.json();
      setProducts(data.products || []);
    } catch (err: any) {
      setError(formatClientError(err, "Failed to load products"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!name.trim() || !modelNumber.trim()) {
      setFormError("Name and model number are required.");
      return;
    }

    setSaving(true);
    try {
      const res = await ownerFetch("/api/v1/product-qr/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          model_number: modelNumber.trim(),
          category: category.trim() || null,
          short_description: description.trim() || null,
          support_disclaimer: supportDisclaimer.trim() || null,
          status,
        }),
      });

      if (!res.ok) {
        const errMsg = await extractApiErrorMessage(res, "Failed to create product");
        throw new Error(errMsg);
      }

      invalidateOwnerCache("/api/v1/product-qr");
      setModalOpen(false);
      setName("");
      setModelNumber("");
      setDescription("");
      setSupportDisclaimer("");
      await fetchProducts();
    } catch (err: any) {
      setFormError(formatClientError(err, "Error creating product"));
    } finally {
      setSaving(false);
    }
  };

  const filtered = products.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.model_number.toLowerCase().includes(search.toLowerCase()) ||
      (p.category && p.category.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <OwnerShell>
      <div className="product-admin-page p-6 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white flex items-center gap-2.5">
              <Package className="w-6 h-6 text-sky-400" />
              Hardware Products & QR Support
            </h1>
            <p className="text-sm text-neutral-400 mt-1">
              Manage hardware SKUs, assign technical manuals, and generate consumer QR support links.
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-sm font-medium transition shadow-lg shadow-sky-500/20"
          >
            <Plus className="w-4 h-4" />
            Register Product SKU
          </button>
        </div>

        {/* Disabled / Error Banner */}
        {error && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0 text-amber-400" />
            <div>
              <p className="font-medium">Product QR Feature Status</p>
              <p className="mt-0.5 text-amber-300/80">{error}</p>
            </div>
          </div>
        )}

        {/* Search Bar */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              placeholder="Search by product name, model number, or category..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-neutral-500 text-sm focus:outline-none focus:border-sky-500/50"
            />
          </div>
          <button
            onClick={fetchProducts}
            title="Refresh"
            className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-300 transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Product Cards Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-48 rounded-2xl bg-white/5 border border-white/10 animate-pulse"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border border-dashed border-white/10 p-8 space-y-3">
            <Package className="w-10 h-10 mx-auto text-neutral-500" />
            <h3 className="text-base font-medium text-white">No products found</h3>
            <p className="text-sm text-neutral-400 max-w-sm mx-auto">
              Register your first appliance or hardware SKU to assign user manuals and generate QR codes.
            </p>
            <button
              onClick={() => setModalOpen(true)}
              className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-medium transition"
            >
              <Plus className="w-4 h-4" />
              Register SKU
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((product) => (
              <Link
                key={product.product_id}
                href={`/products/${product.product_id}`}
                className="group block p-5 rounded-2xl bg-white/5 hover:bg-white/[0.08] border border-white/10 hover:border-sky-500/30 transition shadow-sm space-y-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-sky-500/10 text-sky-400 border border-sky-500/20">
                      {product.model_number}
                    </span>
                    <h3 className="text-base font-medium text-white mt-1.5 group-hover:text-sky-300 transition line-clamp-1">
                      {product.name}
                    </h3>
                  </div>
                  <span
                    className={`text-[10px] font-medium px-2 py-0.5 rounded-full border capitalize ${
                      product.status === "active"
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : product.status === "draft"
                        ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                        : "bg-neutral-500/10 text-neutral-400 border-neutral-500/20"
                    }`}
                  >
                    {product.status || "active"}
                  </span>
                </div>

                <p className="text-xs text-neutral-400 line-clamp-2 min-h-[2rem]">
                  {product.short_description || product.description || "No description provided for this product SKU."}
                </p>

                {/* Counts & Status */}
                <div className="flex items-center gap-4 text-xs text-neutral-400 pt-2 border-t border-white/5">
                  <span className="flex items-center gap-1.5 text-neutral-300">
                    <FileText className="w-3.5 h-3.5 text-sky-400" />
                    {product.assigned_documents_count ?? 0} manual(s)
                  </span>
                  <span className="flex items-center gap-1.5 text-neutral-300">
                    <Link2 className="w-3.5 h-3.5 text-emerald-400" />
                    {product.active_links_count ?? 0} active QR(s)
                  </span>
                </div>

                <div className="pt-2 flex items-center justify-between text-xs text-neutral-400">
                  <span>{product.category || "Uncategorized"}</span>
                  <span className="flex items-center gap-1 text-sky-400 group-hover:translate-x-0.5 transition-transform">
                    <QrCode className="w-3.5 h-3.5" />
                    Manage QRs
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Modal: Register Product */}
        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <div className="product-admin-dialog bg-neutral-900 border border-white/15 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-5">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Package className="w-5 h-5 text-sky-400" />
                  Register Hardware SKU
                </h2>
                <button
                  onClick={() => setModalOpen(false)}
                  className="p-1 rounded-lg text-neutral-400 hover:text-white transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {formError && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                  {formError}
                </div>
              )}

              <form onSubmit={handleCreate} className="space-y-4 text-sm">
                <div>
                  <label className="block text-xs font-medium text-neutral-300 mb-1">
                    Product Title *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. PureFlow Pro RO+UV Water Purifier"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-neutral-500 focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-neutral-300 mb-1">
                      Model / SKU # *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. PF-RO-700"
                      value={modelNumber}
                      onChange={(e) => setModelNumber(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-neutral-500 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-300 mb-1">
                      Category
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Water Purifier"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-neutral-500 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-300 mb-1">
                    Short Description / Specs
                  </label>
                  <textarea
                    rows={2}
                    placeholder="7-stage residential water purifier with mineral booster..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-neutral-500 focus:outline-none focus:border-sky-500 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-300 mb-1">
                    Support Disclaimer (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Grounded strictly in authorized PureFlow manuals."
                    value={supportDisclaimer}
                    onChange={(e) => setSupportDisclaimer(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-neutral-500 focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div className="pt-3 border-t border-white/10 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-neutral-300 hover:text-white text-xs font-medium transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white text-xs font-medium transition shadow-md shadow-sky-500/20"
                  >
                    {saving ? "Registering..." : "Register Product"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </OwnerShell>
  );
}
