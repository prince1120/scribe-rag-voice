"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Package,
  Plus,
  QrCode,
  Search,
  FileText,
  AlertTriangle,
  RefreshCw,
  X,
  Link2,
} from "lucide-react";
import { OwnerShell } from "../components/owner/OwnerShell";
import { ownerFetch } from "../lib/ownerFetch";
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

      setModalOpen(false);
      setName("");
      setModelNumber("");
      setDescription("");
      setSupportDisclaimer("");
      await fetchProducts();
    } catch (err: any) {
      setFormError(formatClientError(err, "Failed to register SKU"));
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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-200/80 pb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 flex items-center gap-2.5">
              <Package className="w-6 h-6 text-[#4854A8]" />
              Hardware Products &amp; QR Support
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              Manage hardware SKUs, assign technical manuals, and generate consumer QR support links.
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#4854A8] hover:bg-[#374191] text-white text-sm font-medium transition shadow-sm hover:shadow-md cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Register Product SKU
          </button>
        </div>

        {/* Feature Status Warning Banner */}
        {error && (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm flex items-start gap-3 shadow-xs">
            <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-950">Product QR Feature Status</p>
              <p className="mt-0.5 text-amber-800 text-xs sm:text-sm leading-relaxed">{error}</p>
            </div>
          </div>
        )}

        {/* Search & Action Bar */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by product name, model number, or category..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-900 placeholder:text-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-[#4854A8]/20 focus:border-[#4854A8] transition shadow-2xs"
            />
          </div>
          <button
            onClick={fetchProducts}
            title="Refresh"
            className="p-2.5 rounded-xl bg-white hover:bg-gray-50 border border-gray-200 text-gray-600 transition shadow-2xs cursor-pointer"
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
                className="h-48 rounded-2xl bg-white border border-gray-200 animate-pulse shadow-xs"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border-2 border-dashed border-gray-200 bg-white p-8 space-y-3 shadow-xs">
            <div className="w-12 h-12 rounded-full bg-indigo-50 text-[#4854A8] flex items-center justify-center mx-auto">
              <Package className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-gray-900">No products found</h3>
            <p className="text-sm text-gray-500 max-w-sm mx-auto leading-relaxed">
              Register your first appliance or hardware SKU to assign user manuals and generate QR codes.
            </p>
            <button
              onClick={() => setModalOpen(true)}
              className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#4854A8] hover:bg-[#374191] text-white text-sm font-medium transition shadow-sm cursor-pointer"
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
                className="group block p-5 rounded-2xl bg-white hover:bg-gray-50/70 border border-gray-200 hover:border-[#4854A8]/40 transition shadow-xs hover:shadow-md space-y-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-md bg-indigo-50 text-[#4854A8] border border-indigo-100">
                      {product.model_number}
                    </span>
                    <h3 className="text-base font-semibold text-gray-900 mt-2 group-hover:text-[#4854A8] transition line-clamp-1">
                      {product.name}
                    </h3>
                  </div>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize ${
                      product.status === "active"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : product.status === "draft"
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-gray-100 text-gray-600 border-gray-200"
                    }`}
                  >
                    {product.status || "active"}
                  </span>
                </div>

                <p className="text-xs text-gray-500 line-clamp-2 min-h-[2rem] leading-relaxed">
                  {product.short_description || product.description || "No description provided for this product SKU."}
                </p>

                {/* Counts & Status */}
                <div className="flex items-center gap-4 text-xs text-gray-600 pt-3 border-t border-gray-100">
                  <span className="flex items-center gap-1.5 font-medium">
                    <FileText className="w-3.5 h-3.5 text-[#4854A8]" />
                    {product.assigned_documents_count ?? 0} manual(s)
                  </span>
                  <span className="flex items-center gap-1.5 font-medium">
                    <Link2 className="w-3.5 h-3.5 text-emerald-600" />
                    {product.active_links_count ?? 0} active QR(s)
                  </span>
                </div>

                <div className="pt-2 flex items-center justify-between text-xs text-gray-500">
                  <span className="bg-gray-100 px-2 py-0.5 rounded text-[11px] font-medium text-gray-600">
                    {product.category || "Uncategorized"}
                  </span>
                  <span className="flex items-center gap-1 text-[#4854A8] font-medium group-hover:translate-x-0.5 transition-transform">
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
            <div className="bg-white border border-gray-200 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-5">
              <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Package className="w-5 h-5 text-[#4854A8]" />
                  Register Hardware SKU
                </h2>
                <button
                  onClick={() => setModalOpen(false)}
                  className="p-1 rounded-lg text-gray-400 hover:text-gray-600 transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {formError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
                  {formError}
                </div>
              )}

              <form onSubmit={handleCreate} className="space-y-4 text-sm">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Product Title *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. PureFlow Pro RO+UV Water Purifier"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4854A8]/20 focus:border-[#4854A8] text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Model / SKU # *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. PF-RO-700"
                      value={modelNumber}
                      onChange={(e) => setModelNumber(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4854A8]/20 focus:border-[#4854A8] text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Category
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Water Purifier"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4854A8]/20 focus:border-[#4854A8] text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Short Description / Specs
                  </label>
                  <textarea
                    rows={2}
                    placeholder="7-stage residential water purifier with mineral booster..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4854A8]/20 focus:border-[#4854A8] resize-none text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Support Disclaimer (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Grounded strictly in authorized PureFlow manuals."
                    value={supportDisclaimer}
                    onChange={(e) => setSupportDisclaimer(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4854A8]/20 focus:border-[#4854A8] text-sm"
                  />
                </div>

                <div className="pt-3 border-t border-gray-100 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-gray-600 hover:text-gray-900 text-xs font-medium transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2.5 rounded-xl bg-[#4854A8] hover:bg-[#374191] disabled:opacity-50 text-white text-xs font-medium transition shadow-sm cursor-pointer"
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
