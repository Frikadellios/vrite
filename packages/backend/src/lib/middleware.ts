import { processAuth } from "./auth";
import { Context } from "./context";
import * as errors from "./errors";
import { HostConfig } from "./host-config";
import { Meta, middleware } from "./trpc";
import { ObjectId } from "mongodb";

interface AuthMiddlewareContextExtension<W extends true | false = true> {
  auth: {
    userId: ObjectId;
    workspaceId: W extends true ? ObjectId : never;
  };
}
interface AuthenticatedContext extends Context, AuthMiddlewareContextExtension<true> {}

const authMiddleware = async <W extends true | false = true>(
  ctx: Context,
  meta?: Meta,
  workspaceBound?: W
): Promise<AuthMiddlewareContextExtension<W>> => {
  const requiredSessionPermissions = meta?.permissions?.session || [];
  const requiredTokenPermissions = meta?.permissions?.token || [];
  const auth = await processAuth(ctx);

  if (!auth) {
    throw errors.unauthorized();
  }

  if (auth.type === "session") {
    if (
      auth.data.baseType !== "admin" &&
      requiredSessionPermissions.some((permission) => !auth.data.permissions.includes(permission))
    ) {
      throw errors.forbidden();
    }

    try {
      return {
        auth: {
          userId: new ObjectId(auth.data.userId),
          ...(workspaceBound ? { workspaceId: new ObjectId(auth.data.workspaceId) } : {})
        }
      } as AuthMiddlewareContextExtension<W>;
    } catch (error) {
      throw errors.badRequest("workspaceError");
    }
  }

  if (requiredTokenPermissions.some((permission) => !auth.data.permissions.includes(permission))) {
    throw errors.forbidden();
  }

  return {
    auth: {
      userId: new ObjectId(auth.data.userId),
      workspaceId: new ObjectId(auth.data.workspaceId)
    }
  } as AuthMiddlewareContextExtension<W>;
};
const isAuthenticated = middleware(async ({ ctx, next, meta }) => {
  const authContextExtension = await authMiddleware(ctx, meta, true);

  return next({ ctx: authContextExtension });
});
const isAuthenticatedUser = middleware(async ({ ctx, next, meta }) => {
  const authContextExtension = await authMiddleware(ctx, meta, false);

  return next({ ctx: authContextExtension });
});
const isEnabled = middleware(async ({ ctx, next, meta }) => {
  const requiredConfig = meta?.requiredConfig || [];

  if (requiredConfig.some((property) => !ctx.fastify.hostConfig[property as keyof HostConfig])) {
    throw errors.serverError();
  }

  return next();
});

export { isAuthenticated, isAuthenticatedUser, isEnabled };
export type { AuthenticatedContext };
