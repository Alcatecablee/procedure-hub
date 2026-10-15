import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { useAuth, useIsAdmin } from "@/lib/auth";
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
} from "@/lib/procedures.server";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Building2,
  FolderTree,
  Tags,
  ShieldCheck,
  Plus,
  Search,
  Pencil,
  Trash2,
  Copy,
  Check,
  Info,
  Users,
  CheckCircle2,
  Shield,
  Briefcase,
  Layers,
} from "lucide-react";

export const Route = createFileRoute("/app/settings")({ component: Settings });

function Settings() {
  const { org, user, profile } = useAuth();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();

  useEffect(() => {
    if (!isAdmin) void navigate({ to: "/app" });
  }, [isAdmin, navigate]);

  const queryClient = useQueryClient();

  // Tab State
  const [activeTab, setActiveTab] = useState("overview");

  // Category State
  const [newCatName, setNewCatName] = useState("");
  const [catSearch, setCatSearch] = useState("");
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState("");
  const [catToDelete, setCatToDelete] = useState<{ id: string; name: string } | null>(null);

  // Department State
  const [newDeptName, setNewDeptName] = useState("");
  const [deptSearch, setDeptSearch] = useState("");
  const [editingDeptId, setEditingDeptId] = useState<string | null>(null);
  const [editDeptName, setEditDeptName] = useState("");
  const [deptToDelete, setDeptToDelete] = useState<{ id: string; name: string } | null>(null);

  // Clipboard feedback
  const [copiedOrgId, setCopiedOrgId] = useState(false);

  // ─── CATEGORY QUERIES & MUTATIONS ─────────────────────────────
  const { data: catData, isLoading: isCatLoading, isError: isCatError } = useQuery({
    queryKey: ["categories", org?.organization.id],
    queryFn: async () => {
      if (!org?.organization.id) return { categories: [] };
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return (await getCategories({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
        data: { organizationId: org.organization.id },
      } as any)) as { categories: Array<{ id: string; name: string; slug?: string }> };
    },
    enabled: !!org?.organization.id,
  });

  const categories = catData?.categories || [];

  const createMut = useMutation({
    mutationFn: async (name: string) => {
      if (!org) throw new Error("No organization selected");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return await createCategory({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
        data: { organizationId: org.organization.id, name: name.trim() },
      });
    },
    onSuccess: () => {
      setNewCatName("");
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Category added successfully");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      if (!org) throw new Error("No organization selected");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return await updateCategory({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
        data: { organizationId: org.organization.id, id, name: name.trim() },
      });
    },
    onSuccess: () => {
      setEditingCatId(null);
      setEditCatName("");
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Category updated");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      if (!org) throw new Error("No organization selected");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return await deleteCategory({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
        data: { organizationId: org.organization.id, id },
      });
    },
    onSuccess: () => {
      setCatToDelete(null);
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Category deleted");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // ─── DEPARTMENT QUERIES & MUTATIONS ───────────────────────────
  const { data: deptData, isLoading: isDeptLoading, isError: isDeptError } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return (await getDepartments({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
      })) as Array<{ id: string; name: string }>;
    },
    enabled: !!org?.organization.id,
  });

  const departments = deptData || [];

  const createDeptMut = useMutation({
    mutationFn: async (name: string) => {
      if (!org) throw new Error("No organization selected");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return await createDepartment({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
        data: { organizationId: org.organization.id, name: name.trim() },
      });
    },
    onSuccess: () => {
      setNewDeptName("");
      queryClient.invalidateQueries({ queryKey: ["departments"] });
      toast.success("Department created");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const updateDeptMut = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      if (!org) throw new Error("No organization selected");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return await updateDepartment({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
        data: { organizationId: org.organization.id, id, name: name.trim() },
      });
    },
    onSuccess: () => {
      setEditingDeptId(null);
      setEditDeptName("");
      queryClient.invalidateQueries({ queryKey: ["departments"] });
      toast.success("Department updated");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const deleteDeptMut = useMutation({
    mutationFn: async (id: string) => {
      if (!org) throw new Error("No organization selected");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return await deleteDepartment({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
        data: { organizationId: org.organization.id, id },
      });
    },
    onSuccess: () => {
      setDeptToDelete(null);
      queryClient.invalidateQueries({ queryKey: ["departments"] });
      toast.success("Department removed");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // Filtered lists
  const filteredDepartments = departments.filter((d) =>
    d.name.toLowerCase().includes(deptSearch.toLowerCase()),
  );

  const filteredCategories = categories.filter((c) =>
    c.name.toLowerCase().includes(catSearch.toLowerCase()),
  );

  const handleCopyOrgId = () => {
    if (org?.organization.id) {
      navigator.clipboard.writeText(org.organization.id);
      setCopiedOrgId(true);
      toast.success("Organization ID copied to clipboard");
      setTimeout(() => setCopiedOrgId(false), 2000);
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="min-h-screen pb-16">
      <PageHeader
        eyebrow="Administration"
        title="Settings & Configuration"
        subtitle="Manage your organization profile, operational departments, procedure categories, and compliance policies."
        actions={
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Organization Active
            </span>
          </div>
        }
      />

      <div className="px-6 md:px-10 py-8 max-w-6xl">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-muted/60 p-1 border border-border rounded-lg inline-flex flex-wrap gap-1">
            <TabsTrigger
              value="overview"
              className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all"
            >
              <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Organization</span>
            </TabsTrigger>
            <TabsTrigger
              value="departments"
              className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all"
            >
              <FolderTree className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Departments</span>
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-muted text-[10px] font-mono">
                {departments.length}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="categories"
              className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all"
            >
              <Tags className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Categories</span>
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-muted text-[10px] font-mono">
                {categories.length}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="policies"
              className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Policies & Audience</span>
            </TabsTrigger>
          </TabsList>

          {/* ─── TAB 1: ORGANIZATION OVERVIEW ───────────────────────── */}
          <TabsContent value="overview" className="space-y-6 mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Organization Identity Card */}
              <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-display font-semibold text-lg">
                      {org?.organization.name?.[0]?.toUpperCase() || "P"}
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">
                        {org?.organization.name || "Procedure Hub"}
                      </h3>
                      <p className="text-xs text-muted-foreground font-mono">
                        slug: {org?.organization.slug || "default"}
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[11px] font-mono uppercase bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    Active
                  </span>
                </div>

                <div className="mt-6 pt-6 border-t border-border space-y-4 text-sm">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Organization ID
                    </label>
                    <div className="mt-1 flex items-center gap-2">
                      <code className="text-xs font-mono bg-muted/60 px-2.5 py-1.5 rounded border border-border flex-1 truncate">
                        {org?.organization.id || "-"}
                      </code>
                      <button
                        type="button"
                        onClick={handleCopyOrgId}
                        className="px-2.5 py-1.5 bg-muted hover:bg-muted/80 text-foreground border border-border rounded text-xs flex items-center gap-1.5 transition-colors"
                        title="Copy Organization ID"
                      >
                        {copiedOrgId ? (
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span className="text-[11px] font-medium">Copy</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-2">
                    <div>
                      <span className="text-xs text-muted-foreground block">Created On</span>
                      <span className="text-xs font-mono font-medium text-foreground">
                        {org?.organization.created_at
                          ? new Date(org.organization.created_at).toLocaleDateString(undefined, {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })
                          : "Initial Setup"}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">Active Departments</span>
                      <span className="text-xs font-mono font-medium text-foreground">
                        {departments.length} departments
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Current Administrator Membership Card */}
              <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-secondary/80 border border-border flex items-center justify-center text-foreground font-medium text-sm">
                    {profile?.full_name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "A"}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">
                      {profile?.full_name || "Administrator"}
                    </h3>
                    <p className="text-xs text-muted-foreground font-mono">{user?.email || "-"}</p>
                  </div>
                </div>

                <div className="mt-6 pt-6 border-t border-border space-y-4 text-sm">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-xs text-muted-foreground block">Assigned Role</span>
                      <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded text-[11px] font-mono font-semibold uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">
                        {org?.role || "admin"}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">Membership Status</span>
                      <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded text-[11px] font-mono uppercase bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        {org?.member.status || "active"}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2">
                    <span className="text-xs text-muted-foreground block">Privileges</span>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      You have full administrative privileges to create and publish procedures,
                      manage team roles, configure departments, and inspect operational compliance.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Platform Infrastructure Details */}
            <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
              <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" />
                Security & Platform Architecture
              </h4>
              <p className="text-xs text-muted-foreground mt-1">
                Overview of tenant isolation and operational compliance guarantees.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 pt-4 border-t border-border text-xs">
                <div className="bg-muted/30 border border-border/80 p-3.5 rounded-md">
                  <span className="font-semibold text-foreground block">Multi-Tenant Isolation</span>
                  <span className="text-muted-foreground mt-0.5 block">
                    All data is strictly partitioned by <code className="text-[11px]">organization_id</code> with Row-Level Security.
                  </span>
                </div>
                <div className="bg-muted/30 border border-border/80 p-3.5 rounded-md">
                  <span className="font-semibold text-foreground block">Audience Obligation Scoping</span>
                  <span className="text-muted-foreground mt-0.5 block">
                    Operational procedures scope acknowledgments by department and role without inflating denominators.
                  </span>
                </div>
                <div className="bg-muted/30 border border-border/80 p-3.5 rounded-md">
                  <span className="font-semibold text-foreground block">Audit Trail Integrity</span>
                  <span className="text-muted-foreground mt-0.5 block">
                    Procedure creations, updates, publications, and acknowledgments are recorded with immutable timestamps.
                  </span>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ─── TAB 2: DEPARTMENTS ─────────────────────────────────── */}
          <TabsContent value="departments" className="space-y-6 mt-6">
            {/* Action Bar: Create Department */}
            <div className="bg-card border border-border rounded-lg p-5 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                    <FolderTree className="w-4 h-4 text-primary" />
                    Operational Departments
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Define divisions to scope frontline procedures and assign managerial oversight.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="New department name..."
                    value={newDeptName}
                    onChange={(e) => setNewDeptName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newDeptName.trim()) {
                        createDeptMut.mutate(newDeptName);
                      }
                    }}
                    className="bg-background border border-input px-3 py-1.5 text-xs rounded-md w-56 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => createDeptMut.mutate(newDeptName)}
                    disabled={!newDeptName.trim() || createDeptMut.isPending}
                    className="bg-primary text-primary-foreground px-3.5 py-1.5 text-xs font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5 transition-all shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{createDeptMut.isPending ? "Adding..." : "Add Department"}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Department Table & Search */}
            <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
              <div className="p-4 bg-muted/40 border-b border-border flex items-center justify-between gap-4 flex-wrap">
                <div className="relative w-full sm:w-72">
                  <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search departments..."
                    value={deptSearch}
                    onChange={(e) => setDeptSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <span className="text-xs font-mono text-muted-foreground">
                  Showing {filteredDepartments.length} of {departments.length} department
                  {departments.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/30 border-b border-border text-xs text-muted-foreground uppercase tracking-wider font-mono">
                    <tr>
                      <th className="px-5 py-3 font-medium">Department Name</th>
                      <th className="px-5 py-3 font-medium">Department ID</th>
                      <th className="px-5 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {isDeptLoading ? (
                      <tr>
                        <td colSpan={3} className="px-5 py-8 text-center text-xs text-muted-foreground italic">
                          Loading departments...
                        </td>
                      </tr>
                    ) : isDeptError ? (
                      <tr>
                        <td colSpan={3} className="px-5 py-8 text-center text-xs text-destructive">
                          Failed to load departments from the server.
                        </td>
                      </tr>
                    ) : filteredDepartments.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-5 py-8 text-center text-xs text-muted-foreground">
                          {deptSearch ? "No departments matching your search filter." : "No departments configured yet."}
                        </td>
                      </tr>
                    ) : (
                      filteredDepartments.map((dept) => (
                        <tr key={dept.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-5 py-3.5">
                            {editingDeptId === dept.id ? (
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={editDeptName}
                                  onChange={(e) => setEditDeptName(e.target.value)}
                                  className="bg-background border border-input px-2.5 py-1 text-xs rounded focus:outline-none focus:ring-1 focus:ring-ring w-64"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && editDeptName.trim()) {
                                      updateDeptMut.mutate({ id: dept.id, name: editDeptName });
                                    } else if (e.key === "Escape") {
                                      setEditingDeptId(null);
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() => updateDeptMut.mutate({ id: dept.id, name: editDeptName })}
                                  disabled={!editDeptName.trim() || updateDeptMut.isPending}
                                  className="px-2.5 py-1 bg-primary text-primary-foreground text-[11px] font-medium rounded hover:bg-primary/90"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingDeptId(null)}
                                  className="px-2.5 py-1 bg-muted text-foreground text-[11px] rounded hover:bg-muted/80"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="font-medium text-foreground flex items-center gap-2">
                                <span>{dept.name}</span>
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-3.5">
                            <code className="text-[11px] font-mono text-muted-foreground bg-muted/50 px-2 py-0.5 rounded">
                              {dept.id}
                            </code>
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            {editingDeptId !== dept.id && (
                              <div className="flex items-center justify-end gap-3">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingDeptId(dept.id);
                                    setEditDeptName(dept.name);
                                  }}
                                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                                  title="Edit Department"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                  <span>Edit</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeptToDelete({ id: dept.id, name: dept.name })}
                                  className="text-xs text-destructive hover:text-destructive/80 flex items-center gap-1 transition-colors"
                                  title="Delete Department"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Delete</span>
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          {/* ─── TAB 3: CATEGORIES ──────────────────────────────────── */}
          <TabsContent value="categories" className="space-y-6 mt-6">
            {/* Action Bar: Create Category */}
            <div className="bg-card border border-border rounded-lg p-5 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                    <Tags className="w-4 h-4 text-primary" />
                    Procedure Categories
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Organize procedures by functional topics (e.g., Compliance, Safety, Operations).
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="New category name..."
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newCatName.trim()) {
                        createMut.mutate(newCatName);
                      }
                    }}
                    className="bg-background border border-input px-3 py-1.5 text-xs rounded-md w-56 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => createMut.mutate(newCatName)}
                    disabled={!newCatName.trim() || createMut.isPending}
                    className="bg-primary text-primary-foreground px-3.5 py-1.5 text-xs font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5 transition-all shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{createMut.isPending ? "Adding..." : "Add Category"}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Category Table & Search */}
            <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
              <div className="p-4 bg-muted/40 border-b border-border flex items-center justify-between gap-4 flex-wrap">
                <div className="relative w-full sm:w-72">
                  <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search categories..."
                    value={catSearch}
                    onChange={(e) => setCatSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <span className="text-xs font-mono text-muted-foreground">
                  Showing {filteredCategories.length} of {categories.length} categor
                  {categories.length === 1 ? "y" : "ies"}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/30 border-b border-border text-xs text-muted-foreground uppercase tracking-wider font-mono">
                    <tr>
                      <th className="px-5 py-3 font-medium">Category Name</th>
                      <th className="px-5 py-3 font-medium">Category ID</th>
                      <th className="px-5 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {isCatLoading ? (
                      <tr>
                        <td colSpan={3} className="px-5 py-8 text-center text-xs text-muted-foreground italic">
                          Loading categories...
                        </td>
                      </tr>
                    ) : isCatError ? (
                      <tr>
                        <td colSpan={3} className="px-5 py-8 text-center text-xs text-destructive">
                          Failed to load categories from the server.
                        </td>
                      </tr>
                    ) : filteredCategories.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-5 py-8 text-center text-xs text-muted-foreground">
                          {catSearch ? "No categories matching your search filter." : "No categories configured yet."}
                        </td>
                      </tr>
                    ) : (
                      filteredCategories.map((cat) => (
                        <tr key={cat.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-5 py-3.5">
                            {editingCatId === cat.id ? (
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={editCatName}
                                  onChange={(e) => setEditCatName(e.target.value)}
                                  className="bg-background border border-input px-2.5 py-1 text-xs rounded focus:outline-none focus:ring-1 focus:ring-ring w-64"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && editCatName.trim()) {
                                      updateMut.mutate({ id: cat.id, name: editCatName });
                                    } else if (e.key === "Escape") {
                                      setEditingCatId(null);
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() => updateMut.mutate({ id: cat.id, name: editCatName })}
                                  disabled={!editCatName.trim() || updateMut.isPending}
                                  className="px-2.5 py-1 bg-primary text-primary-foreground text-[11px] font-medium rounded hover:bg-primary/90"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingCatId(null)}
                                  className="px-2.5 py-1 bg-muted text-foreground text-[11px] rounded hover:bg-muted/80"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="font-medium text-foreground flex items-center gap-2">
                                <span>{cat.name}</span>
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-3.5">
                            <code className="text-[11px] font-mono text-muted-foreground bg-muted/50 px-2 py-0.5 rounded">
                              {cat.id}
                            </code>
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            {editingCatId !== cat.id && (
                              <div className="flex items-center justify-end gap-3">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingCatId(cat.id);
                                    setEditCatName(cat.name);
                                  }}
                                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                                  title="Edit Category"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                  <span>Edit</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setCatToDelete({ id: cat.id, name: cat.name })}
                                  className="text-xs text-destructive hover:text-destructive/80 flex items-center gap-1 transition-colors"
                                  title="Delete Category"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Delete</span>
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          {/* ─── TAB 4: AUDIENCE & COMPLIANCE POLICIES ──────────────── */}
          <TabsContent value="policies" className="space-y-6 mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Audience Definition Card */}
              <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="p-2 rounded-md bg-primary/10 text-primary">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground">
                    Acknowledgment Audience Model
                  </h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Procedure Hub employs explicit audience scoping to ensure accurate compliance calculations without inflating denominators.
                </p>

                <div className="mt-5 space-y-3.5">
                  <div className="p-3 bg-muted/40 border border-border rounded-md">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-foreground">Staff Only (Default)</span>
                      <span className="font-mono text-[10.5px] uppercase text-primary font-medium">Frontline Workflows</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Operational procedures intended for everyday execution obligate frontline <code>staff</code> members only. Management and administrators are automatically excluded from the compliance denominator.
                    </p>
                  </div>

                  <div className="p-3 bg-muted/40 border border-border rounded-md">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-foreground">All Active Members</span>
                      <span className="font-mono text-[10.5px] uppercase text-amber-600 dark:text-amber-400 font-medium">Organization Policies</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Company-wide policies (e.g. Code of Conduct, Information Security) require acknowledgment from all active eligible roles: <code>owner</code>, <code>admin</code>, <code>manager</code>, and <code>staff</code>.
                    </p>
                  </div>
                </div>
              </div>

              {/* Department Scoping Rules Card */}
              <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="p-2 rounded-md bg-secondary/80 text-foreground">
                    <FolderTree className="w-4 h-4" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground">
                    Departmental Scope Rules
                  </h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Procedures can be scoped either globally or targeted to a specific department.
                </p>

                <div className="mt-5 space-y-3.5">
                  <div className="p-3 bg-muted/40 border border-border rounded-md">
                    <span className="text-xs font-semibold text-foreground block mb-1">Department-Scoped Procedures</span>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      When a procedure is assigned to a department, only active members assigned to that same department are obligated. Team members in other departments will not see or be penalized for unacknowledged records.
                    </p>
                  </div>

                  <div className="p-3 bg-muted/40 border border-border rounded-md">
                    <span className="text-xs font-semibold text-foreground block mb-1">Global Organization Procedures</span>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      When a procedure has no department assignment, it applies across the entire organization to all members within the configured audience.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Role Permissions Matrix */}
            <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
              <div className="p-5 border-b border-border bg-muted/30">
                <h4 className="text-sm font-semibold text-foreground">Role Permissions Matrix</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Authority and access boundaries enforced across Procedure Hub.
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50 border-b border-border font-mono uppercase text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3 font-medium">Role</th>
                      <th className="px-4 py-3 font-medium">View Procedures</th>
                      <th className="px-4 py-3 font-medium">Acknowledge</th>
                      <th className="px-4 py-3 font-medium">Create & Edit</th>
                      <th className="px-4 py-3 font-medium">Publish</th>
                      <th className="px-4 py-3 font-medium">Manage Team & Settings</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    <tr className="hover:bg-muted/30">
                      <td className="px-5 py-3 font-medium font-mono uppercase text-foreground">Owner / Admin</td>
                      <td className="px-4 py-3 text-emerald-600 font-medium">Full Org</td>
                      <td className="px-4 py-3 text-emerald-600 font-medium">Yes</td>
                      <td className="px-4 py-3 text-emerald-600 font-medium">Yes</td>
                      <td className="px-4 py-3 text-emerald-600 font-medium">Yes</td>
                      <td className="px-4 py-3 text-emerald-600 font-medium">Yes</td>
                    </tr>
                    <tr className="hover:bg-muted/30">
                      <td className="px-5 py-3 font-medium font-mono uppercase text-foreground">Manager</td>
                      <td className="px-4 py-3 text-emerald-600 font-medium">Full Org</td>
                      <td className="px-4 py-3 text-emerald-600 font-medium">Yes</td>
                      <td className="px-4 py-3 text-emerald-600 font-medium">Own Dept</td>
                      <td className="px-4 py-3 text-emerald-600 font-medium">Own Dept</td>
                      <td className="px-4 py-3 text-muted-foreground">Dept Team Only</td>
                    </tr>
                    <tr className="hover:bg-muted/30">
                      <td className="px-5 py-3 font-medium font-mono uppercase text-foreground">Staff</td>
                      <td className="px-4 py-3 text-emerald-600 font-medium">Active Only</td>
                      <td className="px-4 py-3 text-emerald-600 font-medium">Yes</td>
                      <td className="px-4 py-3 text-muted-foreground">No</td>
                      <td className="px-4 py-3 text-muted-foreground">No</td>
                      <td className="px-4 py-3 text-muted-foreground">No</td>
                    </tr>
                    <tr className="hover:bg-muted/30">
                      <td className="px-5 py-3 font-medium font-mono uppercase text-foreground">Viewer</td>
                      <td className="px-4 py-3 text-emerald-600 font-medium">Active Only</td>
                      <td className="px-4 py-3 text-muted-foreground">No</td>
                      <td className="px-4 py-3 text-muted-foreground">No</td>
                      <td className="px-4 py-3 text-muted-foreground">No</td>
                      <td className="px-4 py-3 text-muted-foreground">No</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* ─── ALERT DIALOG: DELETE DEPARTMENT ─────────────────────── */}
      <AlertDialog open={!!deptToDelete} onOpenChange={(open) => !open && setDeptToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Department</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove{" "}
              <strong className="text-foreground">"{deptToDelete?.name}"</strong>? Procedures
              currently assigned to this department will become unassigned, but will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deptToDelete) deleteDeptMut.mutate(deptToDelete.id);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteDeptMut.isPending ? "Removing..." : "Remove Department"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── ALERT DIALOG: DELETE CATEGORY ───────────────────────── */}
      <AlertDialog open={!!catToDelete} onOpenChange={(open) => !open && setCatToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Category</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove{" "}
              <strong className="text-foreground">"{catToDelete?.name}"</strong>? Existing
              procedures tagged with this category will have their category field set to unassigned.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (catToDelete) deleteMut.mutate(catToDelete.id);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMut.isPending ? "Removing..." : "Remove Category"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
