import { Storage } from "@plasmohq/storage";
import {
  BESTBLOGS_ON_INSTALL_URL,
  BESTBLOGS_SUBMIT_ENDPOINT,
  BESTBLOGS_TRUSTED_DOMAINS,
  LOCAL_DEV_TRUSTED_DOMAINS,
} from "~bestblogs/config";
import { getAllAccountInfo } from "~sync/account";
import {
  // injectScriptsToTabs,
  type SyncData,
  type SyncDataPlatform,
  createTabsForPlatforms,
  getPlatformInfos,
} from "~sync/common";
import QuantumEntanglementKeepAlive from "../utils/keep-alive";
import { linkExtensionMessageHandler, starter } from "./services/api";
import {
  addTabsManagerMessages,
  tabsManagerHandleTabRemoved,
  tabsManagerHandleTabUpdated,
  tabsManagerMessageHandler,
} from "./services/tabs";
import { trustDomainMessageHandler } from "./services/trust-domain";

const storage = new Storage({
  area: "local",
});

interface ScrapedArticleData {
  title: string;
  author: string;
  cover: string;
  content: string;
  digest: string;
}

const DEFAULT_TRUSTED_DOMAINS = ["multipost.app", ...BESTBLOGS_TRUSTED_DOMAINS, ...LOCAL_DEV_TRUSTED_DOMAINS];

async function initDefaultTrustedDomains() {
  const trustedDomains = await storage.get<Array<{ id: string; domain: string }>>("trustedDomains");
  const existingTrustedDomains = trustedDomains || [];
  const existingDomainSet = new Set(existingTrustedDomains.map(({ domain }) => domain));
  const missingTrustedDomains = DEFAULT_TRUSTED_DOMAINS.filter((domain) => !existingDomainSet.has(domain)).map(
    (domain) => ({
      id: crypto.randomUUID(),
      domain,
    }),
  );

  if (missingTrustedDomains.length > 0) {
    await storage.set("trustedDomains", [...existingTrustedDomains, ...missingTrustedDomains]);
  }
}

chrome.runtime.onInstalled.addListener((object) => {
  if (object.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    chrome.tabs.create({ url: BESTBLOGS_ON_INSTALL_URL });
  }
  initDefaultTrustedDomains();
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
});

async function parseBestBlogsSubmitResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

async function submitCurrentPageToBestBlogs() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab found");
  }
  if (!tab.url?.startsWith("http://") && !tab.url?.startsWith("https://")) {
    throw new Error("Current page cannot be submitted");
  }

  const article = (await chrome.tabs.sendMessage(tab.id, {
    type: "MULTIPOST_EXTENSION_REQUEST_SCRAPER_START",
  })) as ScrapedArticleData | undefined;

  if (!article?.title || !article.content) {
    throw new Error("Failed to scrape article content");
  }

  const endpoint = (await storage.get<string>("bestblogsSubmitEndpoint")) || BESTBLOGS_SUBMIT_ENDPOINT;
  const payload = {
    ...article,
    sourceUrl: tab.url,
    sourceTitle: tab.title || article.title,
    submittedVia: "multipost-extension",
    extensionVersion: chrome.runtime.getManifest().version,
    scrapedAt: new Date().toISOString(),
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const responseBody = await parseBestBlogsSubmitResponse(response);

  if (!response.ok) {
    const message =
      typeof responseBody === "object" && responseBody && "message" in responseBody
        ? String(responseBody.message)
        : response.statusText;
    throw new Error(`BestBlogs submit failed (${response.status}): ${message}`);
  }

  return {
    ok: true,
    endpoint,
    articleTitle: article.title,
    sourceUrl: tab.url,
    response: responseBody,
  };
}

// Listen Message || 监听消息 || START
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handled =
    defaultMessageHandler(request, sender, sendResponse) ||
    tabsManagerMessageHandler(request, sender, sendResponse) ||
    trustDomainMessageHandler(request, sender, sendResponse) ||
    linkExtensionMessageHandler(request, sender, sendResponse);
  return handled;
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  tabsManagerHandleTabUpdated(tabId, changeInfo, tab);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  tabsManagerHandleTabRemoved(tabId);
});
// Listen Message || 监听消息 || END

// Message Handler || 消息处理器 || START
let currentSyncData: SyncData | null = null;
let currentPublishPopup: chrome.windows.Window | null = null;
const defaultMessageHandler = (request, _sender, sendResponse) => {
  if (request.action === "MULTIPOST_EXTENSION_CHECK_SERVICE_STATUS") {
    sendResponse({ extensionId: chrome.runtime.id });
    return true;
  }
  if (request.action === "MULTIPOST_EXTENSION_PUBLISH") {
    const data = request.data as SyncData;
    currentSyncData = data;
    sendResponse({ status: "received", extensionId: chrome.runtime.id });
    (async () => {
      currentPublishPopup = await chrome.windows.create({
        url: chrome.runtime.getURL("tabs/publish.html"),
        type: "popup",
        width: 800,
        height: 600,
      });
    })();
    return true;
  }
  if (request.action === "MULTIPOST_EXTENSION_PLATFORMS") {
    getPlatformInfos()
      .then((platforms) => {
        sendResponse({ platforms });
      })
      .catch((error) => {
        sendResponse({ error: String(error instanceof Error ? error.message : error) });
      });
    return true;
  }
  if (request.action === "MULTIPOST_EXTENSION_GET_ACCOUNT_INFOS") {
    getAllAccountInfo()
      .then((accountInfo) => {
        sendResponse({ accountInfo });
      })
      .catch((error) => {
        sendResponse({ error: String(error instanceof Error ? error.message : error) });
      });
    return true;
  }
  if (request.action === "MULTIPOST_EXTENSION_OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    sendResponse({ extensionId: chrome.runtime.id });
    return true;
  }
  if (request.action === "MULTIPOST_EXTENSION_BESTBLOGS_SUBMIT_CURRENT_PAGE") {
    (async () => {
      try {
        sendResponse(await submitCurrentPageToBestBlogs());
      } catch (error) {
        sendResponse({
          ok: false,
          error: String(error instanceof Error ? error.message : error),
        });
      }
    })();
    return true;
  }
  if (request.action === "MULTIPOST_EXTENSION_REFRESH_ACCOUNT_INFOS") {
    chrome.windows.create({
      url: chrome.runtime.getURL("tabs/refresh-accounts.html"),
      type: "popup",
      width: 800,
      height: 600,
      focused: request.data.isFocused || false,
    });
    sendResponse({ status: "ok" });
    return true;
  }
  if (request.action === "MULTIPOST_EXTENSION_PUBLISH_REQUEST_SYNC_DATA") {
    sendResponse({ syncData: currentSyncData });
    return true;
  }
  if (request.action === "MULTIPOST_EXTENSION_PUBLISH_NOW") {
    const data = request.data as SyncData;
    if (Array.isArray(data.platforms) && data.platforms.length > 0) {
      (async () => {
        try {
          const tabs = await createTabsForPlatforms(data);
          // await injectScriptsToTabs(tabs, data);

          addTabsManagerMessages({
            syncData: data,
            tabs: tabs.map((t: { tab: chrome.tabs.Tab; platformInfo: SyncDataPlatform }) => ({
              tab: t.tab,
              platformInfo: t.platformInfo,
            })),
          });

          // for (const t of tabs) {
          //   if (t.tab.id) {
          //     await chrome.tabs.update(t.tab.id, { active: true });
          //     await new Promise((resolve) => setTimeout(resolve, 2000));
          //   }
          // }
          if (currentPublishPopup) {
            await chrome.windows.update(currentPublishPopup.id, { focused: true });
          }

          sendResponse({
            tabs: tabs.map((t: { tab: chrome.tabs.Tab; platformInfo: SyncDataPlatform }) => ({
              tab: t.tab,
              platformInfo: t.platformInfo,
            })),
          });
        } catch (error) {
          // Do not sendResponse here: the publish popup's handlePublishComplete treats ANY
          // callback response as "publish complete", so an error payload would be mis-read as success.
          // Preserve original behavior (log only); success path above sends the tabs response.
          console.error("创建标签页或分组时出错:", error);
        }
      })();
    }
    // Claim this action regardless of platform count, mirroring the original blanket return-true:
    // the success path responds asynchronously; error/empty paths intentionally send no response.
    return true;
  }
  return false;
};
starter(1000 * 30);
// Message Handler || 消息处理器 || END

// Keep Alive || 保活机制 || START
const quantumKeepAlive = new QuantumEntanglementKeepAlive();
quantumKeepAlive.startEntanglementProcess();
// Keep Alive || 保活机制 || END
