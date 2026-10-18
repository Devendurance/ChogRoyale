import { getRequestId, success } from "@/lib/errors";
import { listAvatars } from "@/lib/avatars";

export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  return success({ avatars: listAvatars() }, { requestId });
}
