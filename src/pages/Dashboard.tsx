import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { generateOTP } from "@/lib/otp";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Upload, Copy, RefreshCw, Trash2, Eye, LogOut, FileText, Clock,
  CheckCircle, XCircle, Shield, Plus
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Tables } from "@/integrations/supabase/types";

type PrintJob = Tables<"print_jobs">;

const Dashboard = () => {
  const { user, signOut } = useAuth();
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [viewingOtp, setViewingOtp] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    const { data, error } = await supabase
      .from("print_jobs")
      .select("*")
      .eq("user_id", user!.id)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to fetch jobs");
    } else {
      setJobs(data || []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ["application/pdf", "image/jpeg", "image/png"];
    if (!allowedTypes.includes(file.type)) {
      toast.error("Only PDF, JPG, and PNG files are supported");
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      toast.error("File must be under 20MB");
      return;
    }

    setUploading(true);

    try {
      const filePath = `${user!.id}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const otp = generateOTP();

      const { error: insertError } = await supabase.from("print_jobs").insert({
        user_id: user!.id,
        file_name: file.name,
        file_path: filePath,
        otp_code: otp,
      });

      if (insertError) throw insertError;

      toast.success("Document uploaded successfully!");
      fetchJobs();
    } catch (error: any) {
      toast.error(error.message || "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const copyPrintLink = (jobId: string) => {
    const link = `${window.location.origin}/print/${jobId}`;
    navigator.clipboard.writeText(link);
    toast.success("Print link copied to clipboard!");
  };

  const regenerateOTP = async (jobId: string) => {
    const otp = generateOTP();
    const { error } = await supabase
      .from("print_jobs")
      .update({ otp_code: otp, otp_attempts: 0 })
      .eq("id", jobId);

    if (error) {
      toast.error("Failed to regenerate OTP");
    } else {
      toast.success("New OTP generated!");
      fetchJobs();
    }
  };

  const deleteJob = async (job: PrintJob) => {
    await supabase.storage.from("documents").remove([job.file_path]);
    const { error } = await supabase.from("print_jobs").delete().eq("id", job.id);

    if (error) {
      toast.error("Failed to delete job");
    } else {
      toast.success("Job deleted");
      fetchJobs();
    }
  };

  const getStatus = (job: PrintJob) => {
    if (job.printed) return { label: "Printed", variant: "default" as const, icon: CheckCircle, color: "text-green-600" };
    if (new Date(job.expires_at) < new Date()) return { label: "Expired", variant: "destructive" as const, icon: XCircle, color: "text-destructive" };
    if (job.otp_attempts >= job.max_attempts) return { label: "Locked", variant: "destructive" as const, icon: XCircle, color: "text-destructive" };
    return { label: "Active", variant: "secondary" as const, icon: Clock, color: "text-primary" };
  };

  const viewingJob = jobs.find((j) => j.id === viewingOtp);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="mx-auto max-w-5xl flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <span className="font-bold text-lg">SecurePrint</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:block">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4 mr-1" /> Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        {/* Upload Section */}
        <Card className="border-dashed border-2 border-primary/30 bg-accent/30">
          <CardContent className="flex flex-col items-center justify-center py-10 gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <Upload className="h-7 w-7 text-primary" />
            </div>
            <div className="text-center">
              <h2 className="text-lg font-semibold">Upload Document</h2>
              <p className="text-sm text-muted-foreground">PDF, JPG, or PNG — max 20MB</p>
            </div>
            <label>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handleUpload}
                disabled={uploading}
                className="hidden"
              />
              <Button asChild disabled={uploading} className="cursor-pointer">
                <span>
                  <Plus className="h-4 w-4 mr-1" />
                  {uploading ? "Uploading..." : "Choose File"}
                </span>
              </Button>
            </label>
          </CardContent>
        </Card>

        {/* Jobs List */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Your Print Jobs</h2>
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : jobs.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-12 text-muted-foreground">
                <FileText className="h-12 w-12 mb-3 opacity-40" />
                <p>No documents uploaded yet</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {jobs.map((job) => {
                const status = getStatus(job);
                const StatusIcon = status.icon;
                return (
                  <Card key={job.id} className="shadow-sm">
                    <CardContent className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 py-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent shrink-0">
                          <FileText className="h-5 w-5 text-accent-foreground" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium truncate">{job.file_name}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                            <StatusIcon className={`h-3.5 w-3.5 ${status.color}`} />
                            <Badge variant={status.variant} className="text-xs">{status.label}</Badge>
                            <span>·</span>
                            <span>Expires {new Date(job.expires_at).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button variant="outline" size="sm" onClick={() => setViewingOtp(job.id)}>
                          <Eye className="h-3.5 w-3.5 mr-1" /> OTP
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => copyPrintLink(job.id)}>
                          <Copy className="h-3.5 w-3.5 mr-1" /> Link
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => regenerateOTP(job.id)}>
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteJob(job)} className="text-destructive hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* OTP View Dialog */}
      <Dialog open={!!viewingOtp} onOpenChange={() => setViewingOtp(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>OTP Code</DialogTitle>
          </DialogHeader>
          {viewingJob && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Share this OTP with the shopkeeper. They'll need it to print the document.
              </p>
              <div className="flex items-center justify-center gap-1">
                {viewingJob.otp_code.split("").map((digit, i) => (
                  <div
                    key={i}
                    className="flex h-12 w-10 items-center justify-center rounded-lg border-2 border-primary/30 bg-accent text-xl font-bold text-foreground"
                  >
                    {digit}
                  </div>
                ))}
              </div>
              <p className="text-xs text-center text-muted-foreground">
                Attempts: {viewingJob.otp_attempts}/{viewingJob.max_attempts}
              </p>
              <Button className="w-full" onClick={() => {
                navigator.clipboard.writeText(viewingJob.otp_code);
                toast.success("OTP copied!");
              }}>
                <Copy className="h-4 w-4 mr-1" /> Copy OTP
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Dashboard;
