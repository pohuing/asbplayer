import FrameBridgeClient, {FetchOptions} from './frame-bridge-client';

export default class UiFrame {
    private readonly _html: (lang: string) => Promise<string>;
    private _fetchOptions: FetchOptions | undefined;
    private _client: FrameBridgeClient | undefined;
    private _frame: HTMLIFrameElement | undefined;
    private _language: string = 'en';
    private _dirty = true;
    private _bound = false;

    constructor(html: (lang: string) => Promise<string>) {
        this._html = html;
    }

    set fetchOptions(fetchOptions: FetchOptions) {
        this._dirty =
            this._dirty ||
            this._fetchOptions?.allowedFetchUrl !== fetchOptions.allowedFetchUrl ||
            this._fetchOptions?.videoSrc !== fetchOptions.videoSrc;
        this._fetchOptions = fetchOptions;
    }

    set language(language: string) {
        this._dirty = this._dirty || this._language !== language;
        this._language = language;
    }

    get hidden() {
        return this._frame === undefined || this._frame.classList.contains('asbplayer-hide');
    }

    get bound() {
        return this._bound;
    }

    async bind(): Promise<boolean> {
        return await this._init();
    }

    async client() {
        await this._init();
        return this._client!;
    }

    private async _init() {
        if (!this._dirty) {
            return false;
        }

        this._dirty = false;
        this._bound = true;
        this._client?.unbind();
        this._frame?.remove();

        this._frame = document.createElement('iframe');
        this._frame.className = 'asbplayer-ui-frame';

        // Prevent iframe from showing up with solid background
        // https://stackoverflow.com/questions/69591128/chrome-is-forcing-a-white-background-on-frames-only-on-some-websites
        this._frame.style.colorScheme = 'normal';
        this._client = new FrameBridgeClient(this._frame, this._fetchOptions);
        document.body.appendChild(this._frame);
        // TODO: the open write close model is severely broken cross browser. Firefox will deny the open calls because it violates Cross Source constraints
        // TODO: I'm not sure if srcdoc has any meaningfully different sideeffects
        // See warning on MDN https://developer.mozilla.org/en-US/docs/Web/API/Document/write
        //const doc = this._frame.contentDocument!;
        //doc.open();
        //doc.write(await this._html(this._language));
        //doc.close();
        this._frame.srcdoc = await this._html(this._language)
        await this._client!.bind();
        return true;
    }

    show() {
        this._frame?.classList.remove('asbplayer-hide');
    }

    hide() {
        this._frame?.classList.add('asbplayer-hide');
        this._frame?.blur();
    }

    unbind() {
        this._dirty = true;
        this._client?.unbind();
        this._frame?.remove();
    }
}
