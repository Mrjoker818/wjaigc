import { Metadata } from "next";
import SharedViewClient from "./shared-view-client";

export const metadata: Metadata = {
  title: "分享对话 - 无界AI",
};

export default async function SharedPage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  return <SharedViewClient shareId={shareId} />;
}
