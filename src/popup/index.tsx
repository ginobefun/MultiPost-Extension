import "~style.css";
import cssText from "data-text:~style.css";
import { Button, HeroUIProvider } from "@heroui/react";
import { BookMarkedIcon, ExternalLinkIcon, Loader2Icon } from "lucide-react";
import type { PlasmoCSConfig } from "plasmo";
import { useState } from "react";
import { BESTBLOGS_PUBLISH_URL } from "~bestblogs/config";

export const config: PlasmoCSConfig = {
  // matches: ["https://www.plasmo.com/*"]
};

export function getShadowContainer() {
  return document.querySelector("#test-shadow").shadowRoot.querySelector("#plasmo-shadow-container");
}

export const getShadowHostId = () => "test-shadow";

export const getStyle = () => {
  const style = document.createElement("style");

  style.textContent = cssText;
  return style;
};

const IndexPopup = () => {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const openPublishDashboard = () => {
    chrome.tabs.create({ url: BESTBLOGS_PUBLISH_URL });
  };

  const submitCurrentPage = async () => {
    setStatus("submitting");
    setMessage(chrome.i18n.getMessage("bestblogsSubmitting"));

    let response: { ok?: boolean; error?: string } | undefined;
    try {
      response = await chrome.runtime.sendMessage({
        action: "MULTIPOST_EXTENSION_BESTBLOGS_SUBMIT_CURRENT_PAGE",
      });
    } catch (error) {
      response = {
        ok: false,
        error: String(error instanceof Error ? error.message : error),
      };
    }

    if (response?.ok) {
      setStatus("success");
      setMessage(chrome.i18n.getMessage("bestblogsSubmitSuccess"));
      return;
    }

    setStatus("error");
    setMessage(response?.error || chrome.i18n.getMessage("bestblogsSubmitError"));
  };

  return (
    <HeroUIProvider>
      <div className="flex flex-col gap-3 w-80 bg-background p-4 text-foreground">
        <div className="flex items-center gap-3">
          <img src={chrome.runtime.getURL("assets/icon.png")} alt="" className="h-8 w-8 rounded-md" />
          <div className="min-w-0">
            <h1 className="truncate font-semibold text-base">{chrome.i18n.getMessage("bestblogsPopupTitle")}</h1>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            color="primary"
            variant="flat"
            startContent={<ExternalLinkIcon size={16} />}
            onPress={openPublishDashboard}>
            {chrome.i18n.getMessage("bestblogsOpenPublish")}
          </Button>
          <Button
            color="primary"
            isDisabled={status === "submitting"}
            startContent={
              status === "submitting" ? (
                <Loader2Icon className="animate-spin" size={16} />
              ) : (
                <BookMarkedIcon size={16} />
              )
            }
            onPress={submitCurrentPage}>
            {chrome.i18n.getMessage("bestblogsSubmitCurrentPage")}
          </Button>
        </div>

        {message ? (
          <div
            className={
              status === "error"
                ? "rounded-md bg-danger-50 px-3 py-2 text-danger-700 text-sm"
                : "rounded-md bg-default-100 px-3 py-2 text-default-700 text-sm"
            }>
            {message}
          </div>
        ) : null}
      </div>
    </HeroUIProvider>
  );
};

export default IndexPopup;
