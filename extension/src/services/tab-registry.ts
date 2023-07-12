import {
    ActiveVideoElement,
    Command,
    ExtensionToAsbPlayerCommandTabsCommand,
    ExtensionToVideoCommand,
    Message,
    VideoTabModel,
} from '@project/common';
import Settings from './settings';

interface SlimTab {
    id: number;
    title: string;
    url: string;
}

interface Asbplayer {
    id: string;
    tab: SlimTab;
    timestamp: number;
    receivedTabs?: ActiveVideoElement[];
    videoPlayer: boolean;
}

interface VideoElement {
    src: string;
    tab: SlimTab;
    timestamp: number;
    synced: boolean;
}

export default class TabRegistry {
    private readonly settings: Settings;
    private onNoSyncedElementsCallback?: () => void;
    private onSyncedElementCallback?: () => void;

    constructor(settings: Settings) {
        this.settings = settings;

        // Update video element state on tab changes
        // Triggers events for when synced video elements appear/disappear
        chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
            this._videoElements();
        });
        chrome.tabs.onUpdated.addListener((tabId, removeInfo) => {
            this._videoElements();
        });
    }

    private async _fetchVideoElementState(): Promise<{ [key: string]: VideoElement }> {
        return (
            ((await chrome.storage.session.get('tabRegistryVideoElements')).tabRegistryVideoElements as {
                [key: string]: VideoElement;
            }) ?? {}
        );
    }

    private _saveVideoElementState(state: { [key: string]: VideoElement }) {
        chrome.storage.session.set({ tabRegistryVideoElements: state });
    }

    private async _videoElements(mutator?: (videoElements: { [key: string]: VideoElement }) => boolean) {
        const tabs = await chrome.tabs.query({});
        const videoElements = await this._fetchVideoElementState();
        const oldVideoElements = { ...videoElements };

        let changed = false;

        for (const id in videoElements) {
            const videoElement = videoElements[id];
            const disappeared =
                tabs.find((t) => t.id === videoElement.tab.id && t.url === videoElement.tab.url) === undefined;

            if (disappeared) {
                changed = true;
                delete videoElements[id];
            }
        }

        if (mutator !== undefined) {
            changed = changed || mutator(videoElements);
        }

        if (changed) {
            this._saveVideoElementState(videoElements);
        }

        const oldSyncedElementExists = Object.values(oldVideoElements).find((v) => v.synced) !== undefined;
        const syncedElementExists = Object.values(videoElements).find((v) => v.synced) !== undefined;

        if (this.onNoSyncedElementsCallback !== undefined && oldSyncedElementExists && !syncedElementExists) {
            this.onNoSyncedElementsCallback();
        } else if (this.onSyncedElementCallback !== undefined && !oldSyncedElementExists && syncedElementExists) {
            this.onSyncedElementCallback();
        }

        return videoElements;
    }

    private async _fetchAsbplayerState(): Promise<{ [key: string]: Asbplayer }> {
        return (
            ((await chrome.storage.session.get('tabRegistryAsbplayers')).tabRegistryAsbplayers as {
                [key: string]: Asbplayer;
            }) ?? {}
        );
    }

    private async _saveAsbplayerState(state: { [key: string]: Asbplayer }) {
        chrome.storage.session.set({ tabRegistryAsbplayers: state });
    }

    private async _asbplayers(mutator?: (asbplayers: { [key: string]: Asbplayer }) => boolean) {
        const tabs = await chrome.tabs.query({});
        const asbplayers = await this._fetchAsbplayerState();
        let changed = false;

        for (const tabId in asbplayers) {
            const asbplayer = asbplayers[tabId];
            const disappeared =
                tabs.find((t) => t.id === asbplayer.tab.id && t.url === asbplayer.tab.url) === undefined;

            if (disappeared) {
                changed = true;
                delete asbplayers[tabId];
            }
        }

        if (mutator !== undefined) {
            changed = changed || mutator(asbplayers);
        }

        if (changed) {
            this._saveAsbplayerState(asbplayers);
        }

        return asbplayers;
    }

    async onAsbplayerHeartbeat(
        tab: chrome.tabs.Tab,
        asbplayerId: string,
        videoPlayer: boolean,
        receivedTabs?: ActiveVideoElement[]
    ) {
        if (tab.id === undefined) {
            return;
        }

        this._updateAsbplayers(tab, asbplayerId, videoPlayer, receivedTabs);

        try {
            const command: ExtensionToAsbPlayerCommandTabsCommand = {
                sender: 'asbplayer-extension-to-player',
                message: {
                    command: 'tabs',
                    tabs: await this._activeVideoElements(),
                    ackRequested: false,
                },
            };
            await chrome.tabs.sendMessage(tab.id, command);
        } catch (e) {
            // Swallow
        }
    }

    async onAsbplayerAckTabs(tab: chrome.tabs.Tab, asbplayerId: string, receivedTabs?: ActiveVideoElement[]) {
        this._updateAsbplayers(tab, asbplayerId, false, receivedTabs);
    }

    private async _updateAsbplayers(
        tab: chrome.tabs.Tab,
        asbplayerId: string,
        videoPlayer: boolean,
        receivedTabs?: ActiveVideoElement[]
    ) {
        if (tab.id === undefined) {
            return;
        }

        const tabId = tab.id;

        await this._asbplayers((asbplayers) => {
            asbplayers[tabId] = {
                tab: {
                    id: tabId,
                    title: tab.title ?? '',
                    url: tab.url ?? '',
                },
                id: asbplayerId,
                timestamp: Date.now(),
                receivedTabs: receivedTabs,
                videoPlayer: videoPlayer,
            };
            return true;
        });
    }

    private async _activeVideoElements() {
        const videoElements = await this._videoElements();
        const activeVideoElements: ActiveVideoElement[] = [];

        for (const id in videoElements) {
            const videoElement = videoElements[id];

            if (videoElement.tab.id) {
                const element: VideoTabModel = {
                    id: videoElement.tab.id,
                    title: videoElement.tab.title,
                    src: videoElement.src,
                };
                activeVideoElements.push(element);
            }
        }

        return activeVideoElements;
    }

    async onVideoElementHeartbeat(tab: chrome.tabs.Tab, src: string, synced: boolean) {
        if (tab.id === undefined) {
            return;
        }

        const tabId = tab.id;

        await this._videoElements((videoElements) => {
            videoElements[`${tab.id}:${src}`] = {
                tab: {
                    id: tabId,
                    title: tab.title ?? '',
                    url: tab.url ?? '',
                },
                src: src,
                timestamp: Date.now(),
                synced: synced,
            };
            return true;
        });
    }

    async onVideoElementDisappeared(tab: chrome.tabs.Tab, src: string) {
        await this._videoElements((videoElements) => {
            const key = `${tab.id}:${src}`;

            if (key in videoElements) {
                delete videoElements[key];
                return true;
            }

            return false;
        });
    }

    onNoSyncedElements(callback: () => void) {
        this.onNoSyncedElementsCallback = callback;
    }

    onSyncedElement(callback: () => void) {
        this.onSyncedElementCallback = callback;
    }

    async publishTabsToAsbplayers() {
        const tabsCommand: ExtensionToAsbPlayerCommandTabsCommand = {
            sender: 'asbplayer-extension-to-player',
            message: {
                command: 'tabs',
                tabs: await this._activeVideoElements(),
                ackRequested: true,
            },
        };

        await this.publishCommandToAsbplayers((asbplayer) => (asbplayer.videoPlayer ? undefined : tabsCommand));
    }

    async publishCommandToAsbplayers<T extends Message>(
        commandFactory: (asbplayer: Asbplayer) => Command<T> | undefined
    ) {
        const asbplayers = await this._asbplayers();

        for (const tabId in asbplayers) {
            try {
                const command = commandFactory(asbplayers[tabId]);

                if (command !== undefined) {
                    await chrome.tabs.sendMessage(Number(tabId), command);
                }
            } catch (e) {
                // Swallow as this usually only indicates that the tab is not an asbplayer tab
            }
        }
    }

    async publishCommandToVideoElements<T extends Message>(
        commandFactory: (videoElement: VideoElement) => ExtensionToVideoCommand<T> | undefined
    ) {
        const videoElements = await this._videoElements();

        for (const id in videoElements) {
            const videoElement = videoElements[id];
            const tabId = videoElement.tab.id;

            if (typeof tabId !== 'undefined') {
                const command = commandFactory(videoElement);

                if (command !== undefined) {
                    chrome.tabs.sendMessage(tabId, command);
                }
            }
        }
    }

    async findAsbplayerTab(filter?: (asbplayer: Asbplayer) => boolean): Promise<number> {
        let chosenTabId = null;
        const now = Date.now();
        let min = null;

        const asbplayers = await this._asbplayers();

        for (const tabId in asbplayers) {
            const asbplayer = asbplayers[tabId];

            if (filter === undefined || filter(asbplayer)) {
                const elapsed = now - asbplayer.timestamp;

                if (min === null || elapsed < min) {
                    min = elapsed;
                    chosenTabId = tabId;
                }
            }
        }

        if (chosenTabId) {
            return Number(chosenTabId);
        }

        return new Promise(async (resolve, reject) => {
            if (!Object.keys(asbplayers).length) {
                await this._createNewTab();
            }
            this._anyAsbplayerTab(resolve, reject, 0, 10, filter);
        });
    }

    async _createNewTab() {
        return new Promise<chrome.tabs.Tab>(async (resolve, reject) => {
            const activeTabs = await chrome.tabs.query({ active: true });
            const activeTabIndex = !activeTabs || activeTabs.length === 0 ? undefined : activeTabs[0].index + 1;
            chrome.tabs.create(
                {
                    active: false,
                    /// TODO: this parameter causes the tab creation to fail on firefox. Considering this has been deprecated for over 9 years now, is this really necessary?
                    //selected: false,
                    url: await this.settings.getSingle('asbplayerUrl'),
                    index: activeTabIndex,
                },
                resolve
            );
        });
    }

    async _anyAsbplayerTab(
        resolve: (value: number | PromiseLike<number>) => void,
        reject: (reason?: any) => void,
        attempt: number,
        maxAttempts: number,
        filter?: (asbplayer: Asbplayer) => boolean
    ) {
        if (attempt >= maxAttempts) {
            reject(new Error('Could not find or create an asbplayer tab'));
            return;
        }

        const asbplayers = await this._asbplayers();

        for (const tabId in asbplayers) {
            if (filter === undefined || filter(asbplayers[tabId])) {
                resolve(Number(tabId));
                return;
            }
        }

        setTimeout(() => this._anyAsbplayerTab(resolve, reject, attempt + 1, maxAttempts, filter), 1000);
    }
}
