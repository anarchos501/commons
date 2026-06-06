import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/session";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const { groupId } = await params;
  const session = await getSession();

  if (session.pendingInviteToken?.groupId === groupId) {
    session.pendingInviteToken = undefined;
    await session.save();
  }

  return new NextResponse(null, { status: 204 });
}
