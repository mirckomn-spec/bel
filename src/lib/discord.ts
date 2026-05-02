type UploadDiscordInput = {
  channelId: string;
  token: string;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  content?: string;
};

type DiscordUploadResult = {
  url: string;
  attachmentId: string;
  messageId: string;
};

export async function uploadFileToDiscordChannel({
  channelId,
  token,
  fileBuffer,
  fileName,
  mimeType,
  content,
}: UploadDiscordInput): Promise<DiscordUploadResult> {
  const formData = new FormData();
  const payload = { content: content ?? "" };
  formData.set("payload_json", JSON.stringify(payload));
  formData.set("files[0]", new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), fileName);

  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Falha ao enviar arquivo para o Discord: ${response.status} ${bodyText}`);
  }

  const data = (await response.json()) as {
    id: string;
    attachments?: Array<{ id: string; url: string }>;
  };

  const attachment = data.attachments?.[0];
  if (!attachment?.url) {
    throw new Error("Discord retornou resposta sem URL de anexo.");
  }

  return {
    url: attachment.url,
    attachmentId: attachment.id,
    messageId: data.id,
  };
}
