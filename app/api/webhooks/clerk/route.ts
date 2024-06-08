/* eslint-disable camelcase */
import { clerkClient } from "@clerk/nextjs/server";
import { WebhookEvent } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { createUser, deleteUser, updateUser } from "@/lib/actions/user.action";

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    return new Response("Webhook secret not configured", { status: 500 });
  }

  const headerPayload = headers();
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response("Missing svix headers", { status: 400 });
  }

  const payload = await req.json();
  const body = JSON.stringify(payload);

  const wh = new Webhook(WEBHOOK_SECRET);

  let evt: WebhookEvent;

  try {
    evt = wh.verify(body, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    }) as WebhookEvent;
  } catch (err) {
    console.error("Error verifying webhook:", err);
    return new Response("Error verifying webhook", { status: 400 });
  }

  const { id } = evt.data;
  if (!id) {
    console.error("Missing user ID in webhook event data");
    return new Response("Missing user ID", { status: 400 });
  }

  const eventType = evt.type;

  try {
    if (eventType === "user.created") {
      const { email_addresses, image_url, first_name, last_name, username } = evt.data;

      const user = {
        clerkId: id,
        email: email_addresses[0].email_address,
        username: username || "",
        firstName: first_name ?? "",
        lastName: last_name ?? "",
        photo: image_url,
      };

      const newUser = await createUser(user);

      if (newUser) {
        await clerkClient.users.updateUserMetadata(id, {
          publicMetadata: {
            userId: newUser._id,
          },
        });
      }

      return NextResponse.json({ message: "User created", user: newUser });
    }

    if (eventType === "user.updated") {
      const { image_url, first_name, last_name, username } = evt.data;

      const user = {
        firstName: first_name ?? "",
        lastName: last_name ?? "",
        username: username || "",
        photo: image_url,
      };

      const updatedUser = await updateUser(id, user);

      return NextResponse.json({ message: "User updated", user: updatedUser });
    }

    if (eventType === "user.deleted") {
      const deletedUser = await deleteUser(id);

      return NextResponse.json({ message: "User deleted", user: deletedUser });
    }

    return new Response("Event type not handled", { status: 400 });
  } catch (err) {
    console.error(`Error processing ${eventType} event:`, err);
    return new Response("Internal server error", { status: 500 });
  }
}
