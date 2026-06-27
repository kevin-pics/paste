/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Copy, 
  Check, 
  QrCode, 
  Share2, 
  ExternalLink,
  Trash2,
  FileText,
  AlignLeft,
  UploadCloud,
  Download,
  X,
  File,
  Plus,
  ClipboardCopy
} from 'lucide-react';

interface SharedFile {
  id: string;
  name: string;
  size: number;
  uploadedAt: number;
  status?: 'syncing' | 'synced';
  clientKey?: string;
}

interface TextClip {
  id: string;
  content: string;
  updatedAt: number;
  isDuplicate?: boolean;
  status?: 'syncing' | 'synced';
  clientKey?: string;
}

export default function App() {
  const [clips, setClips] = useState<TextClip[]>([]);
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [clipsLoaded, setClipsLoaded] = useState(false);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [roomId, setRoomId] = useState('global');
  const [activeTab, setActiveTab] = useState<'all' | 'text' | 'files'>('all');
  const [isUploading, setIsUploading] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isAddTextOpen, setIsAddTextOpen] = useState(false);
  const [manualText, setManualText] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showQR, setShowQR] = useState(false);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const clipsRef = useRef<TextClip[]>([]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    const id = setTimeout(() => {
      setToastMessage(prev => prev === msg ? null : prev);
    }, 2500);
    return () => clearTimeout(id);
  };

  // Get Room ID from URL hash or default
  useEffect(() => {
    const getHash = () => window.location.hash.slice(1) || 'global';
    
    const updateRoom = () => {
      const hash = getHash().trim();
      if (/^[a-zA-Z0-9_\-]+$/.test(hash)) {
        setRoomId(hash);
      } else {
        setRoomId('global');
      }
    };

    updateRoom();
    window.addEventListener('hashchange', updateRoom);
    return () => window.removeEventListener('hashchange', updateRoom);
  }, []);

  // Keep clipsRef in sync so paste handler (stale closure) can access latest clips
  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);

  // Clips Sync Logic
  useEffect(() => {
    let isCurrent = true;
    setClipsLoaded(false);
    const fetchClips = async () => {
      try {
        const response = await fetch(`/api/clips/${roomId}`);
        if (!isCurrent) return;
        if (response.ok) {
          const data = await response.json();
          setClips(prev => {
            const syncingItems = prev.filter(c => c.status === 'syncing' || (c.id && c.id.toString().startsWith('temp_')));
            const updatedServerItems = (data as TextClip[]).map(newC => {
              const existing = prev.find(oldC => oldC.id === newC.id);
              if (existing) {
                return {
                  ...newC,
                  clientKey: existing.clientKey,
                  status: existing.status,
                };
              }
              return newC;
            });
            const filteredSyncing = syncingItems.filter(s => !updatedServerItems.some(u => u.id === s.id));
            return [...filteredSyncing, ...updatedServerItems];
          });
        }
      } catch (err) {
        console.error('Fetch clips failed:', err);
      } finally {
        if (isCurrent) {
          setClipsLoaded(true);
        }
      }
    };

    fetchClips();
    const interval = setInterval(fetchClips, 5000);
    return () => {
      isCurrent = false;
      clearInterval(interval);
    };
  }, [roomId]);

  // Files Sync Logic
  useEffect(() => {
    let isCurrent = true;
    setFilesLoaded(false);
    const fetchFiles = async () => {
      try {
        const response = await fetch(`/api/files/${roomId}`);
        if (!isCurrent) return;
        if (response.ok) {
          const data = await response.json();
          setFiles(prev => {
            const syncingItems = prev.filter(f => f.status === 'syncing' || (f.id && f.id.toString().startsWith('temp_')));
            const updatedServerItems = (data as SharedFile[]).map(newF => {
              const existing = prev.find(oldF => oldF.id === newF.id);
              if (existing) {
                return {
                  ...newF,
                  clientKey: existing.clientKey,
                  status: existing.status,
                };
              }
              return newF;
            });
            const filteredSyncing = syncingItems.filter(s => !updatedServerItems.some(u => u.id === s.id));
            return [...filteredSyncing, ...updatedServerItems];
          });
        }
      } catch (err) {
        console.error('Fetch files failed:', err);
      } finally {
        if (isCurrent) {
          setFilesLoaded(true);
        }
      }
    };

    fetchFiles();
    const interval = setInterval(fetchFiles, 10000);
    return () => {
      isCurrent = false;
      clearInterval(interval);
    };
  }, [roomId]);

  // Unified file upload logic
  const uploadFilesDirectly = async (fileList: FileList | File[]) => {
    if (fileList.length === 0) return;

    setIsUploading(true);
    const now = Date.now();
    const tempFiles: SharedFile[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      const tempId = `temp_${now}_${i}`;
      tempFiles.push({
        id: tempId,
        clientKey: tempId,
        name: f.name,
        size: f.size,
        uploadedAt: now,
        status: 'syncing'
      });
    }

    // Add temp items to state instantly
    setFiles(prev => [...tempFiles, ...prev]);

    const formData = new FormData();
    for (let i = 0; i < fileList.length; i++) {
      formData.append('file', fileList[i]);
    }

    try {
      const response = await fetch(`/api/files/${roomId}`, {
        method: 'POST',
        body: formData,
      });
      
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        console.error(`[ERROR] Non-JSON response from upload:`, text.slice(0, 100));
        // Remove temp files on error
        setFiles(prev => prev.filter(f => !f.id.startsWith(`temp_${now}_`)));
        return;
      }

      if (response.ok) {
        const newFiles: SharedFile[] = await response.json();
        const syncedFiles = newFiles.map((f, i) => ({
          ...f,
          clientKey: tempFiles[i]?.clientKey || `temp_${now}_${i}`,
          status: 'synced' as const
        }));

        setFiles(prev => {
          const filtered = prev.filter(f => !f.id.startsWith(`temp_${now}_`));
          return [...syncedFiles, ...filtered];
        });

        // After 2 seconds, remove 'synced' status
        setTimeout(() => {
          setFiles(prev => prev.map(f => {
            if (newFiles.some(nf => nf.id === f.id)) {
              const { status, ...rest } = f;
              return rest;
            }
            return f;
          }));
        }, 2000);

        showToast(`${newFiles.length} file(s) uploaded successfully!`);
        setActiveTab(prev => prev === 'text' ? 'all' : prev);
      } else {
        // Remove temp files on failure
        setFiles(prev => prev.filter(f => !f.id.startsWith(`temp_${now}_`)));
        console.error(`[ERROR] Upload failed with status ${response.status}`);
      }
    } catch (err) {
      // Remove temp files on error
      setFiles(prev => prev.filter(f => !f.id.startsWith(`temp_${now}_`)));
      console.error('Upload failed:', err);
    } finally {
      setIsUploading(false);
    }
  };

  // Support global paste anywhere on the page
  useEffect(() => {
    const handleGlobalPaste = async (e: ClipboardEvent) => {
      // Ignore if user is actively focused on an input or textarea (like the manual input modal)
      if (
        e.target instanceof HTMLInputElement || 
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return;
      }

      const pastedFiles = e.clipboardData?.files;
      if (pastedFiles && pastedFiles.length > 0) {
        e.preventDefault();
        await uploadFilesDirectly(pastedFiles);
        setActiveTab(prev => prev === 'text' ? 'all' : prev);
        return;
      }

      const pastedText = e.clipboardData?.getData('text/plain')?.trim();
      if (pastedText) {
        e.preventDefault();
        setActiveTab(prev => prev === 'files' ? 'all' : prev);

        // Check locally before creating a temp card
        const existingLocal = clipsRef.current.find(c => c.content === pastedText);
        if (existingLocal) {
          const now = Date.now();
          setClips(prev => {
            const filtered = prev.filter(c => c.id !== existingLocal.id);
            return [{ ...existingLocal, updatedAt: now }, ...filtered];
          });
          fetch(`/api/clips/${roomId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: pastedText }),
          }).catch(() => {});
          showToast('Already exists!');
          return;
        }

        const now = Date.now();
        const tempId = `temp_${now}`;

        // Add temporary clip to state instantly
        const tempClip: TextClip = {
          id: tempId,
          clientKey: tempId,
          content: pastedText,
          updatedAt: now,
          status: 'syncing'
        };
        setClips(prev => [tempClip, ...prev]);

        try {
          const response = await fetch(`/api/clips/${roomId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: pastedText }),
          });
          if (response.ok) {
            const newClip = await response.json();
            const syncedClip = { ...newClip, clientKey: tempId, status: 'synced' as const };

            if (newClip.isDuplicate) {
              // Another client added this content concurrently; remove temp and move existing to top
              setClips(prev => {
                const filtered = prev.filter(c => c.id !== tempId && c.id !== syncedClip.id);
                return [syncedClip, ...filtered];
              });
              showToast('Already exists!');
            } else {
              setClips(prev => {
                const filtered = prev.filter(c => c.id !== tempId);
                return [syncedClip, ...filtered];
              });

              // After 2 seconds, remove 'synced' status
              setTimeout(() => {
                setClips(prev => prev.map(c => {
                  if (c.id === syncedClip.id) {
                    const { status, ...rest } = c;
                    return rest;
                  }
                  return c;
                }));
              }, 2000);

              showToast('Text card added!');
            }
          } else {
            // Remove temp clip on error/failure
            setClips(prev => prev.filter(c => c.id !== tempId));
          }
        } catch (err) {
          console.error('Failed to save pasted text:', err);
          // Remove temp clip on error
          setClips(prev => prev.filter(c => c.id !== tempId));
        }
      }
    };

    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [roomId]);

  // Drag and drop event handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragActive(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      setIsDragActive(false);
      dragCounter.current = 0;
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    dragCounter.current = 0;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await uploadFilesDirectly(e.dataTransfer.files);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await uploadFilesDirectly(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const pasteFromClipboard = async () => {
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        const fileBlobs: File[] = [];
        for (const item of items) {
          for (const type of item.types) {
            if (type !== 'text/plain' && type !== 'text/html') {
              const blob = await item.getType(type);
              const ext = type.split('/')[1] || 'bin';
              fileBlobs.push(new File([blob], `pasted.${ext}`, { type }));
            }
          }
        }
        if (fileBlobs.length > 0) {
          await uploadFilesDirectly(fileBlobs);
          setActiveTab(prev => prev === 'text' ? 'all' : prev);
          return;
        }
      }
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      if (!trimmed) return;
      setActiveTab(prev => prev === 'files' ? 'all' : prev);
      const existingLocal = clipsRef.current.find(c => c.content === trimmed);
      if (existingLocal) {
        const now = Date.now();
        setClips(prev => {
          const filtered = prev.filter(c => c.id !== existingLocal.id);
          return [{ ...existingLocal, updatedAt: now }, ...filtered];
        });
        fetch(`/api/clips/${roomId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: trimmed }),
        }).catch(() => {});
        showToast('Already exists!');
        return;
      }
      const now = Date.now();
      const tempId = `temp_${now}`;
      const tempClip: TextClip = { id: tempId, clientKey: tempId, content: trimmed, updatedAt: now, status: 'syncing' };
      setClips(prev => [tempClip, ...prev]);
      try {
        const response = await fetch(`/api/clips/${roomId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: trimmed }),
        });
        if (response.ok) {
          const newClip = await response.json();
          const syncedClip = { ...newClip, clientKey: tempId, status: 'synced' as const };
          if (newClip.isDuplicate) {
            setClips(prev => {
              const filtered = prev.filter(c => c.id !== tempId && c.id !== syncedClip.id);
              return [syncedClip, ...filtered];
            });
            showToast('Already exists!');
          } else {
            setClips(prev => {
              const filtered = prev.filter(c => c.id !== tempId);
              return [syncedClip, ...filtered];
            });
            setTimeout(() => {
              setClips(prev => prev.map(c => {
                if (c.id === syncedClip.id) { const { status, ...rest } = c; return rest; }
                return c;
              }));
            }, 2000);
            showToast('Text card added!');
          }
        } else {
          setClips(prev => prev.filter(c => c.id !== tempId));
        }
      } catch {
        setClips(prev => prev.filter(c => c.id !== tempId));
      }
    } catch {
      showToast('Cannot access clipboard');
    }
  };

  const handleFileDelete = async (fileId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const response = await fetch(`/api/files/${roomId}/${fileId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setFiles(prev => prev.filter(f => f.id !== fileId));
        showToast('File deleted successfully');
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const handleClipDelete = async (clipId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const response = await fetch(`/api/clips/${roomId}/${clipId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setClips(prev => prev.filter(c => c.id !== clipId));
        showToast('Text card deleted');
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const handleClearAll = async () => {
    try {
      const response = await fetch(`/api/clear/${roomId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setClips([]);
        setFiles([]);
        showToast('All items cleared successfully!');
        setIsClearConfirmOpen(false);
      } else {
        showToast('Failed to clear items');
      }
    } catch (err) {
      console.error('Clear failed:', err);
      showToast('Error occurred while clearing');
    }
  };

  const handleAddTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const textToSubmit = manualText.trim();
    if (!textToSubmit) return;

    // Check locally before creating a temp card
    const existingLocal = clips.find(c => c.content === textToSubmit);
    if (existingLocal) {
      const now = Date.now();
      setClips(prev => {
        const filtered = prev.filter(c => c.id !== existingLocal.id);
        return [{ ...existingLocal, updatedAt: now }, ...filtered];
      });
      fetch(`/api/clips/${roomId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: textToSubmit }),
      }).catch(() => {});
      setManualText('');
      setIsAddTextOpen(false);
      showToast('Already exists!');
      return;
    }

    const now = Date.now();
    const tempId = `temp_${now}`;

    // Add temporary clip to state instantly
    const tempClip: TextClip = {
      id: tempId,
      clientKey: tempId,
      content: textToSubmit,
      updatedAt: now,
      status: 'syncing'
    };
    setClips(prev => [tempClip, ...prev]);
    setManualText('');
    setIsAddTextOpen(false);
    setActiveTab(prev => prev === 'files' ? 'all' : prev);

    try {
      const response = await fetch(`/api/clips/${roomId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: textToSubmit }),
      });
      if (response.ok) {
        const newClip = await response.json();
        const syncedClip = { ...newClip, clientKey: tempId, status: 'synced' as const };

        if (newClip.isDuplicate) {
          // Another client added this content concurrently; remove temp and move existing to top
          setClips(prev => {
            const filtered = prev.filter(c => c.id !== tempId && c.id !== syncedClip.id);
            return [syncedClip, ...filtered];
          });
          showToast('Already exists!');
        } else {
          setClips(prev => {
            const filtered = prev.filter(c => c.id !== tempId);
            return [syncedClip, ...filtered];
          });

          // After 2 seconds, remove 'synced' status
          setTimeout(() => {
            setClips(prev => prev.map(c => {
              if (c.id === syncedClip.id) {
                const { status, ...rest } = c;
                return rest;
              }
              return c;
            }));
          }, 2000);

          showToast('Text card added!');
        }
      } else {
        // Remove temp clip on failure
        setClips(prev => prev.filter(c => c.id !== tempId));
        showToast('Failed to add text clip');
      }
    } catch (err) {
      console.error('Failed to save manual text:', err);
      // Remove temp clip on error
      setClips(prev => prev.filter(c => c.id !== tempId));
      showToast('Error occurred while adding text clip');
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const renderContentWithLinks = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.split(urlRegex).map((part, i) => {
      if (part.match(urlRegex)) {
        return (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline break-all relative z-10 cursor-pointer inline m-0 p-0 border-0 outline-none hover:text-blue-700 font-semibold"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            {part}
          </a>
        );
      }
      return part;
    });
  };

  // Combine clips and files chronologically for 'all' tab
  const combinedItems = [
    ...clips.map(c => ({ ...c, itemType: 'text' as const })),
    ...files.map(f => ({ ...f, itemType: 'file' as const }))
  ].sort((a, b) => {
    const timeA = a.itemType === 'text' ? (a as TextClip).updatedAt : (a as SharedFile).uploadedAt;
    const timeB = b.itemType === 'text' ? (b as TextClip).updatedAt : (b as SharedFile).uploadedAt;
    return timeB - timeA; // Chronological order descending (newer first)
  });

  const filteredItems = combinedItems.filter(item => {
    if (activeTab === 'all') return true;
    if (activeTab === 'text') return item.itemType === 'text';
    if (activeTab === 'files') return item.itemType === 'file';
    return true;
  });

  const shareUrl = window.location.href;

  return (
    <div 
      className="min-h-screen bg-[#f8f9fa] text-[#1a1a1a] font-sans selection:bg-blue-100 p-4 md:p-8 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] flex flex-col items-center relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Global Drag and Drop Overlay */}
      <AnimatePresence>
        {isDragActive && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-blue-600/90 border-4 border-dashed border-white m-4 rounded-3xl flex flex-col items-center justify-center text-white z-50 transition-all backdrop-blur-[2px]"
          >
            <UploadCloud className="w-16 h-16 mb-4 animate-bounce" />
            <h3 className="text-2xl font-bold">Drop files to upload</h3>
            <p className="text-white/80 text-sm mt-2">Instantly share with all devices in this room</p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="w-full max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex items-end justify-between">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-3"
          >
            <div className="bg-blue-600 p-2.5 rounded-2xl text-white shadow-md shadow-blue-500/10">
              <Share2 size={22} />
            </div>
            <div>
              <h1 id="app-title" className="text-2xl font-bold tracking-tight text-gray-900">Paste</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-xs text-gray-500 font-mono">
                  Room: {roomId}
                </p>
                <div className="relative">
                  <button
                    id="qr-toggle-btn"
                    onClick={() => setShowQR(!showQR)}
                    className={`p-1 rounded-lg transition-all cursor-pointer border ${
                      showQR 
                        ? 'bg-blue-600 text-white border-blue-600 shadow-md' 
                        : 'text-gray-400 bg-white border-gray-200 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50'
                    }`}
                    title="Toggle QR Code"
                  >
                    <QrCode size={13} />
                  </button>

                  <AnimatePresence>
                    {showQR && (
                      <>
                        <div 
                          className="fixed inset-0 z-40" 
                          onClick={() => setShowQR(false)} 
                        />
                        <motion.div
                          id="qr-popover"
                          initial={{ opacity: 0, scale: 0.95, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: 10 }}
                          className="absolute top-full mt-2 left-0 z-50 bg-white p-4 rounded-2xl shadow-2xl border border-gray-100 flex flex-col items-center text-center space-y-3 min-w-[200px]"
                        >
                          <div className="bg-blue-50/50 p-3 rounded-xl border border-blue-100/30">
                            <QRCodeCanvas 
                              value={shareUrl} 
                              size={120}
                              level="H"
                              includeMargin={false}
                              className="rounded-lg"
                            />
                          </div>
                          <div className="space-y-1">
                            <p className="text-[10px] text-gray-500">Scan code to access this room</p>
                          </div>
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </motion.div>

        </div>

        {/* Action Controls and Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-2 rounded-2xl border border-gray-200 shadow-sm">
          {/* Left section: Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 bg-gray-50 p-1 rounded-xl">
              {(['all', 'text', 'files'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 text-xs font-semibold capitalize rounded-lg transition-all cursor-pointer ${
                    activeTab === tab
                      ? 'bg-white text-blue-600 shadow-sm font-bold'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  {tab === 'all' ? 'All items' : tab === 'text' ? `Text Clips (${clips.length})` : `Files (${files.length})`}
                </button>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Paste: mobile only */}
            <button
              onClick={pasteFromClipboard}
              className="md:hidden flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg sm:rounded-xl cursor-pointer transition-colors text-xs sm:text-sm font-medium"
              title="Paste from clipboard"
            >
              <ClipboardCopy size={14} />
              Paste
            </button>

            {/* Upload: mobile only */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="md:hidden flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg sm:rounded-xl cursor-pointer transition-colors disabled:opacity-50 text-xs sm:text-sm font-medium"
              title={isUploading ? 'Uploading...' : 'Upload File'}
            >
              <UploadCloud size={14} />
              Upload
            </button>

            {(clips.length > 0 || files.length > 0) && (
              <>
                {/* Clear All: mobile icon + text */}
                <button
                  onClick={() => setIsClearConfirmOpen(true)}
                  className="md:hidden flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-2 bg-white border border-red-200 hover:bg-red-50 text-red-600 rounded-lg sm:rounded-xl cursor-pointer transition-colors text-xs sm:text-sm font-medium"
                  title="Clear All"
                >
                  <Trash2 size={14} />
                  Clear all
                </button>
                {/* Clear All: desktop icon + text */}
                <button
                  onClick={() => setIsClearConfirmOpen(true)}
                  className="hidden md:flex items-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-red-500 rounded-xl cursor-pointer transition-colors text-sm font-medium"
                  title="Clear All"
                >
                  <Trash2 size={14} />
                  Clear all
                </button>
              </>
            )}

            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              className="hidden" 
              multiple
            />
          </div>
        </div>

        {/* Cards Grid */}
        <div className="min-h-[40vh] flex flex-col justify-center">
          {!(clipsLoaded && filesLoaded) ? (
            <div className="flex flex-col items-center justify-center p-12">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-3"></div>
              <p className="text-sm text-gray-400">Loading workspace...</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-3xl p-12 text-center flex flex-col items-center justify-center min-h-[40vh] shadow-sm">
              <div className="bg-blue-50 p-6 rounded-full mb-4 text-blue-500">
                <FileText size={32} />
              </div>
              <h3 className="text-lg font-bold text-gray-800">
                <span className="md:hidden">Add any text or file.</span>
                <span className="hidden md:inline">Paste or drop anything here.</span>
              </h3>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <>
                {filteredItems.map((item) => {
                  if (item.itemType === 'text') {
                    const clip = item as TextClip;
                    return (
                      <div
                        key={`text_${clip.clientKey || clip.id}`}
                        onClick={() => {
                          if (clip.status === 'syncing') return;
                          navigator.clipboard.writeText(clip.content.trim());
                          showToast('Text copied to clipboard!');
                        }}
                        className={`border rounded-2xl overflow-hidden transition-all duration-200 relative flex flex-col justify-between group h-56 ${
                          clip.status === 'syncing' 
                            ? 'border-gray-200 cursor-not-allowed opacity-75' 
                            : 'border-gray-200 hover:border-gray-300 hover:shadow-lg hover:shadow-gray-100/60 cursor-pointer'
                        }`}
                      >
                        <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5 flex items-center justify-between text-xs font-mono shrink-0">
                          <span className="flex items-center gap-1.5 font-semibold text-gray-500">
                            <AlignLeft size={11} />
                            Text Clip
                          </span>
                          <div className="relative h-4 w-32 flex justify-end items-center">
                            <span className={`absolute right-0 transition-opacity duration-300 flex items-center gap-1 font-semibold text-blue-500 whitespace-nowrap ${
                              clip.status === 'syncing' ? 'opacity-100' : 'opacity-0 pointer-events-none'
                            }`}>
                              <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-ping shrink-0" />
                              Syncing...
                            </span>
                            <span className={`absolute right-0 transition-opacity duration-300 flex items-center gap-1 font-semibold text-green-600 whitespace-nowrap ${
                              clip.status === 'synced' ? 'opacity-100' : 'opacity-0 pointer-events-none'
                            }`}>
                              <Check size={12} className="shrink-0" />
                              Synced
                            </span>
                            <span className={`absolute right-0 transition-opacity duration-300 flex items-center gap-1 font-semibold text-gray-500 whitespace-nowrap ${
                              !clip.status ? 'opacity-0 group-hover:opacity-100' : 'opacity-0 pointer-events-none'
                            }`}>
                              <Copy size={12} />
                              Click to copy
                            </span>
                          </div>
                        </div>
                        <div className="flex-1 overflow-hidden px-4 pt-3">
                          <p className="text-sm text-gray-700 whitespace-pre-wrap break-words font-sans line-clamp-6 leading-relaxed">
                            {renderContentWithLinks(clip.content)}
                          </p>
                        </div>
                        <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 shrink-0 text-[10px] text-gray-400 font-mono">
                          <span>{new Date(clip.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          {clip.status !== 'syncing' && (
                            <button
                              onClick={(e) => handleClipDelete(clip.id, e)}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all cursor-pointer"
                              title="Delete card"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  } else {
                    const file = item as SharedFile;
                    return (
                      <div
                        key={`file_${file.clientKey || file.id}`}
                        onClick={() => {
                          if (file.status === 'syncing') return;
                          const link = document.createElement('a');
                          link.href = `/api/files/${roomId}/${file.id}`;
                          link.setAttribute('download', file.name);
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                        }}
                        className={`border rounded-2xl overflow-hidden transition-all duration-200 relative flex flex-col justify-between group h-56 ${
                          file.status === 'syncing' 
                            ? 'border-gray-200 cursor-not-allowed opacity-75' 
                            : 'border-gray-200 hover:border-gray-300 hover:shadow-lg hover:shadow-gray-100/60 cursor-pointer'
                        }`}
                      >
                        <div className="bg-indigo-50 border-b border-gray-200 px-4 py-2.5 flex items-center justify-between text-xs font-mono shrink-0">
                          <span className="flex items-center gap-1.5 font-semibold text-indigo-700">
                            <File size={11} />
                            Shared File
                          </span>
                          <div className="relative h-4 w-36 flex justify-end items-center">
                            <span className={`absolute right-0 transition-opacity duration-300 flex items-center gap-1 font-semibold text-blue-500 whitespace-nowrap ${
                              file.status === 'syncing' ? 'opacity-100' : 'opacity-0 pointer-events-none'
                            }`}>
                              <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-ping shrink-0" />
                              Syncing...
                            </span>
                            <span className={`absolute right-0 transition-opacity duration-300 flex items-center gap-1 font-semibold text-green-600 whitespace-nowrap ${
                              file.status === 'synced' ? 'opacity-100' : 'opacity-0 pointer-events-none'
                            }`}>
                              <Check size={12} className="shrink-0" />
                              Synced
                            </span>
                            <span className={`absolute right-0 transition-opacity duration-300 flex items-center gap-1 font-semibold text-indigo-600 whitespace-nowrap ${
                              !file.status ? 'opacity-0 group-hover:opacity-100' : 'opacity-0 pointer-events-none'
                            }`}>
                              <Download size={12} />
                              Click to download
                            </span>
                          </div>
                        </div>
                        <div className="flex-1 overflow-hidden flex flex-col px-4 pt-3">
                          <div className="flex items-start gap-3">
                            <div className="bg-indigo-50/80 p-3 rounded-xl text-indigo-600 shrink-0 border border-indigo-100 group-hover:scale-105 transition-transform duration-200">
                              <FileText size={24} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-800 break-all line-clamp-3 leading-snug">{file.name}</p>
                              <p className="text-xs text-gray-400 font-mono mt-1">{formatFileSize(file.size)}</p>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 shrink-0 text-[10px] text-gray-400 font-mono">
                          <span>{new Date(file.uploadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          {file.status !== 'syncing' && (
                            <button
                              onClick={(e) => handleFileDelete(file.id, e)}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all cursor-pointer"
                              title="Delete file"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  }
                })}
              </>
            </div>
          )}
        </div>

        {/* Pro Tip panel */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100/30 w-full"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 bg-blue-100 text-blue-700 p-1.5 rounded-lg shrink-0">
              <ExternalLink size={14} />
            </div>
            <div>
              <h4 className="text-xs font-semibold text-blue-900">Rooms & Direct Access</h4>
              <p className="text-xs text-blue-700/70 mt-1 leading-relaxed">
                Add any text after a '#' in the URL (e.g. <code>#my_room</code>) to create a separate room workspace. Texts and files pasted there are kept separate.
              </p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Manual Add Text Modal */}
      <AnimatePresence>
        {isAddTextOpen && (
          <>
            {/* Modal Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddTextOpen(false)}
              className="fixed inset-0 bg-black/40 z-50 backdrop-blur-[1px]"
            />
            {/* Modal Dialog */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white w-[calc(100%-2rem)] max-w-lg rounded-2xl shadow-2xl border border-gray-100 p-6 z-50 flex flex-col space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-gray-900">Add Text Clip</h3>
                <button
                  onClick={() => setIsAddTextOpen(false)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleAddTextSubmit} className="flex flex-col space-y-4">
                <textarea
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  placeholder="Paste or type your text clip content here..."
                  className="w-full h-48 p-4 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm leading-relaxed"
                  autoFocus
                  required
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsAddTextOpen(false)}
                    className="px-4 py-2 border border-gray-200 hover:bg-gray-50 text-gray-600 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors cursor-pointer"
                  >
                    Add Clip
                  </button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Clear All Confirmation Modal */}
      <AnimatePresence>
        {isClearConfirmOpen && (
          <>
            {/* Modal Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsClearConfirmOpen(false)}
              className="fixed inset-0 bg-black/40 z-50 backdrop-blur-[1px]"
            />
            {/* Modal Dialog */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white w-[calc(100%-2rem)] max-w-sm rounded-2xl shadow-2xl border border-gray-100 p-6 z-50 flex flex-col space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-gray-900">Clear All Items?</h3>
                <button
                  onClick={() => setIsClearConfirmOpen(false)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              <p className="text-sm text-gray-500 leading-relaxed">
                Are you sure you want to permanently delete all text cards and files in this room? This action cannot be undone.
              </p>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsClearConfirmOpen(false)}
                  className="px-4 py-2 border border-gray-200 hover:bg-gray-50 text-gray-600 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleClearAll}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors cursor-pointer"
                >
                  Clear All
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Global Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.95 }}
            className="fixed bottom-6 bg-gray-900 text-white text-xs font-semibold py-3 px-5 rounded-xl shadow-lg flex items-center gap-2 z-50 font-mono"
          >
            <Check size={14} className="text-green-400" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
