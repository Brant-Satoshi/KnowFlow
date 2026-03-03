'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { FileDoc } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Upload, FileText, Trash2, FileCode } from 'lucide-react';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const statusColors: Record<string, string> = {
  uploaded: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  parsing: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  indexed: 'bg-green-500/10 text-green-700 dark:text-green-400',
  failed: 'bg-red-500/10 text-red-700 dark:text-red-400',
};

export default function FilesPage() {
  const [files, setFiles] = useState<FileDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [parsingIds, setParsingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch('/api/files');
      const json = await res.json();
      if (json.ok) {
        setFiles(json.data.files);
      } else {
        setError(json.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();
      if (json.ok) {
        setFiles(prev => [...prev, json.data.file]);
      } else {
        setError(json.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleUpload(file);
    }
  }, [handleUpload]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/files/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.ok) {
        setFiles(prev => prev.filter(f => f.id !== id));
      } else {
        setError(json.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  }, []);

  const handleParse = useCallback(async (id: string) => {
    setParsingIds(prev => new Set(prev).add(id));
    setError(null);
    try {
      const res = await fetch(`/api/files/${id}/parse`, { method: 'POST' });
      const json = await res.json();
      if (json.ok) {
        setFiles(prev => prev.map(f => f.id === id ? json.data.file : f));
      } else {
        toast({ variant: 'destructive', description: json.error || 'Parse failed' });
        fetchFiles();
      }
    } catch (e) {
      toast({ variant: 'destructive', description: e instanceof Error ? e.message : 'Parse failed' });
      fetchFiles();
    } finally {
      setParsingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [fetchFiles]);

  return (
    <div className="container mx-auto py-8 max-w-5xl">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-xl">Files</CardTitle>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.txt"
              onChange={handleFileSelect}
              disabled={uploading}
              className="hidden"
              id="file-upload"
            />
            <label htmlFor="file-upload">
              <Button variant="outline" size="sm" asChild disabled={uploading}>
                <span className="cursor-pointer">
                  <Upload className="h-4 w-4 mr-2" />
                  {uploading ? 'Uploading...' : 'Upload'}
                </span>
              </Button>
            </label>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
              {error}
            </div>
          )}

          {loading ? (
            <div className="text-muted-foreground">Loading...</div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <FileText className="h-12 w-12 mb-4 opacity-50" />
              <p>No files uploaded yet</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Size</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Created</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {files.map((file) => (
                    <tr key={file.id} className="hover:bg-muted/50">
                      <td className="px-4 py-3 text-sm">{file.name}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{file.type}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{formatSize(file.size)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs rounded-full ${statusColors[file.status] || 'bg-muted'}`}>
                          {file.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{formatDate(file.createdAt)}</td>
                      <td className="px-4 py-3 text-right space-x-1">
                        {file.status === 'uploaded' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleParse(file.id)}
                            disabled={parsingIds.has(file.id)}
                            title="Parse file"
                          >
                            <FileCode className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(file.id)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
