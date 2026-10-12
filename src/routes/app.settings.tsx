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

export const Route = createFileRoute("/app/settings")({ component: Settings });

function Settings() {
  const { org } = useAuth();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  useEffect(() => {
    if (!isAdmin) void navigate({ to: "/app" });
  }, [isAdmin, navigate]);
  const queryClient = useQueryClient();

  const [newCatName, setNewCatName] = useState("");
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState("");

  const [newDeptName, setNewDeptName] = useState("");
  const [editingDeptId, setEditingDeptId] = useState<string | null>(null);
  const [editDeptName, setEditDeptName] = useState("");

  const { data: catData, isLoading, isError } = useQuery({
    queryKey: ["categories", org?.organization.id],
    queryFn: async () => {
      if (!org?.organization.id) return { categories: [] };
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return await getCategories({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
        data: { organizationId: org.organization.id },
      } as any);
    },
    enabled: !!org?.organization.id,
  });

  const categories = catData?.categories || [];

  const createMut = useMutation({
    mutationFn: async (name: string) => {
      if (!org) throw new Error("No org");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return await createCategory({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
        data: { organizationId: org.organization.id, name },
      });
    },
    onSuccess: () => {
      setNewCatName("");
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      if (!org) throw new Error("No org");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return await updateCategory({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
        data: { organizationId: org.organization.id, id, name },
      });
    },
    onSuccess: () => {
      setEditingCatId(null);
      setEditCatName("");
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      if (!org) throw new Error("No org");
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
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const { data: deptData, isLoading: isDeptLoading, isError: isDeptError } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return await getDepartments({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
      });
    },
    enabled: !!org?.organization.id,
  });

  const departments = deptData || [];

  const createDeptMut = useMutation({
    mutationFn: async (name: string) => {
      if (!org) throw new Error("No org");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return await createDepartment({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
        data: { organizationId: org.organization.id, name },
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
      if (!org) throw new Error("No org");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return await updateDepartment({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
        data: { organizationId: org.organization.id, id, name },
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
      if (!org) throw new Error("No org");
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
      queryClient.invalidateQueries({ queryKey: ["departments"] });
      toast.success("Department removed");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (!isAdmin) return null;
  return (
    <div>
      <PageHeader
        eyebrow="Folio 06"
        title="Settings & configuration"
        subtitle="Manage the structural parameters of the record."
      />
      <div className="px-6 md:px-10 py-6 max-w-4xl space-y-12">
        <section>
          <div className="eyebrow mb-6">Article I - Categories</div>
          <div className="text-sm text-ink-soft mb-4">
            Categories classify procedures within the ledger. They provide organizational boundaries
            for operational knowledge.
          </div>

          <div className="border-t border-border-strong divide-y divide-border">
            {isError ? (
              <div className="py-4 text-sm text-destructive font-display italic">
                Failed to load categories.
              </div>
            ) : isLoading ? (
              <div className="py-4 text-sm text-muted-foreground font-display italic">
                Loading categories...
              </div>
            ) : categories.map((c: any) => (
              <div key={c.id} className="py-4 flex items-center justify-between">
                {editingCatId === c.id ? (
                  <div className="flex gap-2 flex-1 mr-4">
                    <input
                      value={editCatName}
                      onChange={(e) => setEditCatName(e.target.value)}
                      className="bg-card border border-input px-3 py-1.5 text-sm rounded-sm flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => updateMut.mutate({ id: c.id, name: editCatName })}
                      disabled={!editCatName || updateMut.isPending}
                      className="bg-primary text-primary-foreground px-3 py-1.5 text-xs rounded-sm hover:bg-primary/90"
                      aria-label={`Save category ${c.name}`}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingCatId(null)}
                      className="bg-card text-foreground border border-input px-3 py-1.5 text-xs rounded-sm hover:bg-accent"
                      aria-label="Cancel editing category"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="font-display text-lg">{c.name}</div>
                    {isAdmin && (
                      <div className="flex items-center gap-4">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCatId(c.id);
                            setEditCatName(c.name);
                          }}
                          className="text-[11px] font-mono uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground"
                          aria-label={`Edit category ${c.name}`}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm("Remove category?")) deleteMut.mutate(c.id);
                          }}
                          className="text-[11px] font-mono uppercase tracking-[0.1em] text-destructive hover:text-destructive/80"
                          aria-label={`Delete category ${c.name}`}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            {!isError && !isLoading && categories.length === 0 && (
              <div className="py-4 text-sm text-muted-foreground italic">
                No categories defined.
              </div>
            )}
          </div>

          {isAdmin && (
            <div className="mt-6 flex gap-3">
              <input
                placeholder="New Category Name"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                className="bg-card border border-input px-3 py-2 text-sm rounded-sm w-64"
              />
              <button
                onClick={() => createMut.mutate(newCatName)}
                disabled={!newCatName || createMut.isPending}
                className="bg-primary text-primary-foreground px-4 py-2 text-sm font-medium rounded-sm hover:bg-primary/90 disabled:opacity-50"
                aria-label="Add new category"
              >
                Add Category
              </button>
            </div>
          )}
        </section>

        <section>
          <div className="eyebrow mb-6">Article II - Departments</div>
          <div className="text-sm text-ink-soft mb-4">
            Departments define operational divisions for procedure assignment and compliance scoping.
          </div>

          <div className="border-t border-border-strong divide-y divide-border">
            {isDeptError ? (
              <div className="py-4 text-sm text-destructive font-display italic">
                Failed to load departments.
              </div>
            ) : isDeptLoading ? (
              <div className="py-4 text-sm text-muted-foreground font-display italic">
                Loading departments...
              </div>
            ) : departments.map((d: any) => (
              <div key={d.id} className="py-4 flex items-center justify-between">
                {editingDeptId === d.id ? (
                  <div className="flex gap-2 flex-1 mr-4">
                    <input
                      value={editDeptName}
                      onChange={(e) => setEditDeptName(e.target.value)}
                      className="bg-card border border-input px-3 py-1.5 text-sm rounded-sm flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => updateDeptMut.mutate({ id: d.id, name: editDeptName })}
                      disabled={!editDeptName || updateDeptMut.isPending}
                      className="bg-primary text-primary-foreground px-3 py-1.5 text-xs rounded-sm hover:bg-primary/90"
                      aria-label={`Save department ${d.name}`}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingDeptId(null)}
                      className="bg-card text-foreground border border-input px-3 py-1.5 text-xs rounded-sm hover:bg-accent"
                      aria-label="Cancel editing department"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="font-display text-lg">{d.name}</div>
                    {isAdmin && (
                      <div className="flex items-center gap-4">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingDeptId(d.id);
                            setEditDeptName(d.name);
                          }}
                          className="text-[11px] font-mono uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground"
                          aria-label={`Edit department ${d.name}`}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm("Remove department? Procedures assigned to it will become unassigned.")) {
                              deleteDeptMut.mutate(d.id);
                            }
                          }}
                          className="text-[11px] font-mono uppercase tracking-[0.1em] text-destructive hover:text-destructive/80"
                          aria-label={`Delete department ${d.name}`}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            {!isDeptError && !isDeptLoading && departments.length === 0 && (
              <div className="py-4 text-sm text-muted-foreground italic">
                No departments defined.
              </div>
            )}
          </div>

          {isAdmin && (
            <div className="mt-6 flex gap-3">
              <input
                placeholder="New Department Name"
                value={newDeptName}
                onChange={(e) => setNewDeptName(e.target.value)}
                className="bg-card border border-input px-3 py-2 text-sm rounded-sm w-64"
              />
              <button
                onClick={() => createDeptMut.mutate(newDeptName)}
                disabled={!newDeptName || createDeptMut.isPending}
                className="bg-primary text-primary-foreground px-4 py-2 text-sm font-medium rounded-sm hover:bg-primary/90 disabled:opacity-50"
                aria-label="Add new department"
              >
                Add Department
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
