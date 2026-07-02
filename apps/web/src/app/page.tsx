"use client";

/**
 * Project creation page (Phase 4 §3, web-project-creation).
 *
 * Initial-request text + scene/style selection -> `POST /api/projects`. On
 * success, carry the returned `projectId` into the discovery flow. Field-scoped
 * validation errors (INVALID_SCENE / STYLE_PROFILE_MISMATCH) attach to the
 * matching control and never clear the user's input.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api, ApiError, type CreateProjectInput } from "@/lib/api";
import { discoveryPath } from "@/lib/workflow";
import type { SceneStyleValue } from "@/components/scene-style-controls";
import { SceneStyleControls } from "@/components/scene-style-controls";
import { ErrorNotice } from "@/components/feedback";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function CreateProjectPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [initialRequest, setInitialRequest] = useState("");
  const [sceneStyle, setSceneStyle] = useState<SceneStyleValue>({ scene: "default" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Field-scoped codes route to the matching control; input is preserved.
  const sceneError =
    error instanceof ApiError && error.code === "INVALID_SCENE"
      ? "所选场景无效，请重新选择。"
      : undefined;
  const styleError =
    error instanceof ApiError && error.code === "STYLE_PROFILE_MISMATCH"
      ? "所选风格与场景不匹配，请调整。"
      : undefined;
  const bannerError = error && !sceneError && !styleError ? error : null;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const input: CreateProjectInput = { scene: sceneStyle.scene };
      if (title.trim()) input.title = title.trim();
      if (initialRequest.trim()) input.initialRequest = initialRequest.trim();
      if (sceneStyle.styleProfileId) input.styleProfileId = sceneStyle.styleProfileId;
      const res = await api.createProject(input);
      router.push(discoveryPath(res.projectId));
    } catch (err) {
      setError(err);
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-6 py-10">
      <Card>
        <CardHeader>
          <CardTitle>新建演示项目</CardTitle>
          <CardDescription>
            先描述你的初始需求并选择场景与风格，再进入需求澄清。不会直接从一句提示生成成品。
          </CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="title">项目标题（可选）</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：Q3 产品发布"
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="initial-request">初始请求</Label>
              <Textarea
                id="initial-request"
                value={initialRequest}
                onChange={(e) => setInitialRequest(e.target.value)}
                placeholder="用一两段话描述你想要的演示内容、受众与目标。"
                rows={5}
                disabled={submitting}
              />
            </div>
            <SceneStyleControls
              value={sceneStyle}
              onChange={setSceneStyle}
              disabled={submitting}
              {...(sceneError ? { sceneError } : {})}
              {...(styleError ? { styleError } : {})}
            />
            {bannerError ? <ErrorNotice error={bannerError} /> : null}
          </CardContent>
          <CardFooter className="mt-6">
            <Button type="submit" disabled={submitting}>
              {submitting ? "创建中…" : "创建并开始澄清"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
