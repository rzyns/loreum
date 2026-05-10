"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@loreum/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@loreum/ui/dialog";
import { Input } from "@loreum/ui/input";
import { Label } from "@loreum/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@loreum/ui/select";

type ApiKeyPermission =
  | "READ_ONLY"
  | "DRAFT_WRITE"
  | "CANONICAL_WRITE"
  | "READ_WRITE"
  | "DRAFT_WRITE_SELF_APPROVE";

type CreateApiKeyPermission = Extract<
  ApiKeyPermission,
  "READ_ONLY" | "DRAFT_WRITE" | "CANONICAL_WRITE"
>;

const DEFAULT_API_KEY_PERMISSION: CreateApiKeyPermission = "DRAFT_WRITE";

interface CreateApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectSlug: string;
  onCreated: (key: {
    id: string;
    name: string;
    permissions: ApiKeyPermission;
    lastUsedAt: null;
    expiresAt: string | null;
    createdAt: string;
    key: string;
  }) => void;
}

export function CreateApiKeyDialog({
  open,
  onOpenChange,
  projectSlug,
  onCreated,
}: CreateApiKeyDialogProps) {
  const [name, setName] = useState("");
  const [permissions, setPermissions] = useState<CreateApiKeyPermission>(
    DEFAULT_API_KEY_PERMISSION,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const result = await api<{
        id: string;
        name: string;
        permissions: ApiKeyPermission;
        expiresAt: string | null;
        createdAt: string;
        key: string;
      }>(`/projects/${projectSlug}/api-keys`, {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          permissions,
        }),
      });
      setName("");
      setPermissions(DEFAULT_API_KEY_PERMISSION);
      onCreated({ ...result, lastUsedAt: null });
    } catch {
      setError("Failed to create API key");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              Generate a key for MCP or programmatic access to this project.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Claude Desktop"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="key-permissions">Permissions</Label>
              <Select
                value={permissions}
                onValueChange={(v) =>
                  setPermissions(v as CreateApiKeyPermission)
                }
              >
                <SelectTrigger id="key-permissions">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="READ_ONLY">Read Only</SelectItem>
                  <SelectItem value="DRAFT_WRITE">
                    Draft / Proposal Write
                  </SelectItem>
                  <SelectItem value="CANONICAL_WRITE">
                    Canonical Write
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter className="mt-4">
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? "Creating..." : "Create key"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
