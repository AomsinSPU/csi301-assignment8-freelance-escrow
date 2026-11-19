import { useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  ZeroAddress,
  getAddress,
  parseEther,
  toQuantity,
  type Eip1193Provider,
} from "ethers";
import {
  readChain,
  date,
  eth,
  eventNames,
  labels,
  same,
  short,
  type Deployment,
  type Job,
  type Snapshot,
} from "./chain";
import "@fontsource/ibm-plex-sans-thai/400.css";
import "@fontsource/ibm-plex-sans-thai/600.css";
import "./style.css";

type Wallet = Eip1193Provider & {
  on?: (name: string, fn: () => void) => void;
  removeListener?: (name: string, fn: () => void) => void;
};
const wallet = (window as Window & { ethereum?: Wallet }).ethereum;
const route = () => location.hash.slice(1) || "/";
type Action = {
  method: string;
  args: unknown[];
  title: string;
  recipient?: string;
  value?: bigint;
  amount?: bigint;
};
function Token({ value }: { value: string }) {
  const [copied, set] = useState(false);
  return (
    <button
      type="button"
      className="token"
      title={value}
      aria-label={"คัดลอก " + value}
      onClick={() =>
        navigator.clipboard
          .writeText(value)
          .then(() => {
            set(true);
            setTimeout(() => set(false), 1200);
          })
          .catch(() => window.prompt("คัดลอกค่า", value))
      }
    >
      {copied ? "คัดลอกแล้ว" : short(value) + " ⧉"}
    </button>
  );
}
function Badge({ n }: { n: number }) {
  return <span className={"badge s" + n}>{labels[n]}</span>;
}
type ConfirmedTransaction = { block: number; hash: string };
function includesTransaction(data: Snapshot | undefined, tx: ConfirmedTransaction) {
  return !!data && data.block >= tx.block &&
    data.jobs.some(job => job.events.some(event => event.hash === tx.hash));
}
function App() {
  const [url, setUrl] = useState(route),
    [d, config] = useState<Deployment>(),
    [data, save] = useState<Snapshot>(),
    [confirmed, setConfirmed] = useState<ConfirmedTransaction>(),
    [loadError, loadFail] = useState(""),
    [seq, reload] = useState(0);
  const [account, acc] = useState(""),
    [chain, net] = useState(0),
    [msg, say] = useState(""),
    [pending, setPending] = useState(false),
    [action, ask] = useState<Action | null>(null),
    [filter, select] = useState(""), [query, search] = useState(""), [roleFilter, setRoleFilter] = useState("");
  const busy = useRef(false),
    identity = useRef(0);
  const reviewDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (action) reviewDialog.current?.showModal();
  }, [action]);
  useEffect(() => {
    const go = () => {
      setUrl(route());
      ask(null);
      select(""); search(""); setRoleFilter("");
      window.scrollTo(0, 0);
    };
    onhashchange = go;
    return () => {
      onhashchange = null;
    };
  }, []);
  useEffect(() => {
    let live = true;
    let p: JsonRpcProvider | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let synced = !confirmed;
    async function update() {
      try {
        const cfg: Deployment = await fetch(
          import.meta.env.BASE_URL + "sepolia.json",
          { cache: "no-store" },
        ).then((r) => r.json());
        if (!live) return;
        if (cfg.chainId !== 11155111) throw Error("ต้องใช้ Sepolia");
        p ??= new JsonRpcProvider(cfg.rpc);
        if (Number((await p.getNetwork()).chainId) !== cfg.chainId)
          throw Error("RPC ไม่ตรงเครือข่าย");
        const result = await readChain(p, cfg);
        if (live) {
          if (confirmed && !includesTransaction(result, confirmed)) {
            synced = false;
            return;
          }
          synced = true;
          config(cfg);
          save(previous => previous && previous.block > result.block ? previous : result);
          loadFail("");
        }
      } catch {
        if (live) loadFail("อ่านสัญญาหรือประวัติไม่ได้ ตรวจการเชื่อมต่อ RPC แล้วลองใหม่");
      } finally {
        if (live) timer = setTimeout(update, synced ? 12000 : 2000);
      }
    }
    update();
    return () => {
      live = false;
      clearTimeout(timer);
      p?.destroy();
    };
  }, [seq, confirmed]);
  useEffect(() => {
    let live = true;
    async function sync() {
      const rev = ++identity.current;
      ask(null);
      acc("");
      net(0);
      if (!wallet) return;
      try {
        const [accounts, id] = await Promise.all([
          wallet.request({ method: "eth_accounts" }),
          wallet.request({ method: "eth_chainId" }),
        ]);
        if (live && rev === identity.current) {
          acc(accounts[0] || "");
          net(Number(id));
        }
      } catch {
        if (live) say("อ่านกระเป๋าไม่ได้");
      }
    }
    sync();
    wallet?.on?.("accountsChanged", sync);
    wallet?.on?.("chainChanged", sync);
    return () => {
      live = false;
      wallet?.removeListener?.("accountsChanged", sync);
      wallet?.removeListener?.("chainChanged", sync);
    };
  }, []);
  const wrong = !!account && !!d && chain !== d.chainId;
  const syncing = !!confirmed && !includesTransaction(data, confirmed);
  const ready = !!account && !wrong && !pending && !syncing && !loadError;
  async function connect() {
    try {
      if (!wallet) {
        say("เปิดเว็บนี้ในเบราว์เซอร์ที่ติดตั้ง MetaMask หรือในเบราว์เซอร์ของแอป MetaMask");
        return;
      }
      if (wrong && d) {
        const id = toQuantity(d.chainId);
        try {
          await wallet.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: id }],
          });
        } catch (e) {
          if ((e as { code: number }).code !== 4902) throw e;
          await wallet.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: id,
                chainName: d.name,
                rpcUrls: [d.rpc],
                nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              },
            ],
          });
        }
      }
      const a = await wallet.request({ method: "eth_requestAccounts" });
      acc(a[0] || "");
      net(Number(await wallet.request({ method: "eth_chainId" })));
      say("");
    } catch {
      say("ยังไม่ได้เชื่อมกระเป๋าหรือเปลี่ยนเครือข่าย");
    }
  }
  async function transact() {
    if (!action || !d || !wallet || !ready || busy.current) return;
    busy.current = true;
    setPending(true);
    const a = action;
    ask(null);
    const revision = identity.current;
    try {
      say("รอยืนยันในกระเป๋า");
      const provider = new BrowserProvider(wallet);
      if (Number((await provider.getNetwork()).chainId) !== d.chainId)
        throw Error("เครือข่ายเปลี่ยน");
      const signer = await provider.getSigner(account);
      const c = new Contract(d.address, d.abi, signer);
      if (revision !== identity.current)
        throw Error("บัญชีเปลี่ยน กรุณาตรวจทานอีกครั้ง");
      const tx = await c[a.method](...a.args, { value: a.value ?? 0n });
      say("ส่งแล้ว รอยืนยัน · " + tx.hash);
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) throw Error("ธุรกรรมล้มเหลว");
      say("ยืนยันธุรกรรมสำเร็จ · " + short(tx.hash));
      setConfirmed({ block: receipt.blockNumber, hash: receipt.hash });
      if ((a.method === "createJob" || a.method === "postJob") && revision === identity.current) {
        for (const log of receipt.logs) {
          const ev = c.interface.parseLog(log);
          if (ev?.name === "JobCreated")
            location.hash = "/jobs/" + ev.args.jobId;
        }
      }
    } catch (e) {
      const err = e as {
        code?: number | string;
        reason?: string;
        shortMessage?: string;
        message?: string;
      };
      say(
        err.code === 4001 || err.code === "ACTION_REJECTED"
          ? "ยกเลิกในกระเป๋าแล้ว"
          : "ทำรายการไม่สำเร็จ · " +
              (err.reason || err.shortMessage || err.message || "กรุณาลองใหม่"),
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const job = data?.jobs.find((j) => url === "/jobs/" + j.id),
    judge = same(account, data?.judge || "");
  const role = (j: Job) =>
    same(account, j.employer)
      ? "ผู้ว่าจ้าง"
      : same(account, j.freelancer)
        ? "ฟรีแลนซ์"
        : judge
          ? "ผู้ดูแล"
          : "ผู้ชม";
  const mine = url === "/" || url === "/mine";
  const dispute = url === "/disputes";
  const list = (data?.jobs || []).filter(
    (j) =>
      !!account && role(j) !== "ผู้ชม" && (!roleFilter || role(j) === roleFilter) &&
      (!query.trim() || j.title.toLowerCase().includes(query.trim().toLowerCase()) || j.id === query.trim().replace(/^#/,"")) &&
      (!dispute || j.status === 3) &&
      (filter === "" || String(j.status) === filter),
  );
  return (
    <>
      <header>
        <div className="bar">
          <a className="brand" href="#/">
            <b>≡</b> Freelance Escrow
          </a>
          <nav>
            <a aria-current={mine ? "page" : undefined} href="#/mine">
              งานของฉัน
            </a>
            <a aria-current={dispute ? "page" : undefined} href="#/disputes">
              ข้อพิพาท
            </a>
          </nav>
          <span className="network">● {d?.name || "เครือข่าย"}</span>
          <button onClick={connect}>
            {wrong
              ? "เปลี่ยนเครือข่าย"
              : account
                ? short(account)
                : "เชื่อม MetaMask"}
          </button>
        </div>
      </header>
      <main>
        {msg && (
          <div className="notice" role="status">
            {msg}
          </div>
        )}
        {loadError && (
          <div className="notice" role="alert">
            {loadError}{" "}
            <button onClick={() => reload((n) => n + 1)}>ลองใหม่</button>
          </div>
        )}
        {wrong && (
          <p className="notice">
            กระเป๋าอยู่คนละเครือข่ายกับสัญญา{" "}
            <button onClick={connect}>เปลี่ยนเครือข่าย</button>
          </p>
        )}
        {syncing ? (
          <p role="status">กำลังอัปเดตสถานะงานและยอดเงินจาก Sepolia…</p>
        ) : !data || !d ? (
          <p aria-live="polite">
            {loadError ? "รอการเชื่อมต่อ" : "กำลังอ่านข้อมูลจากสัญญา…"}
          </p>
        ) : job ? (
          <Detail
            key={job.id + account}
            j={job}
            d={d}
            role={role(job)}
            now={data.now}
            ready={ready}
            ask={ask}
            connect={connect}
            account={account}
          />
        ) : url === "/jobs/new" ? (
          <Create
            account={account}
            judge={data.judge}
            now={data.now}
            ready={ready}
            connect={connect}
            ask={ask}
          />
        ) : mine || dispute ? (
          <>
            <div className="heading">
              <div>
                <p className="eyebrow">
                  {account ? "พื้นที่ทำงาน" : "ดูข้อมูลสาธารณะ"}
                </p>
                <h1>
                  {dispute ? "ข้อพิพาท" : "งานของฉัน"}
                </h1>
              </div>
              {!dispute && !judge && (
                <a className="primary" href="#/jobs/new">
                  + สร้างงาน
                </a>
              )}
            </div>
            <section className="card">
              {account && <div className="filters">
                <label>ค้นหางาน<input type="search" placeholder="ชื่อโครงการ หรือ #รหัสงาน" value={query} onChange={e=>search(e.target.value)}/></label>
                {mine && <label>สถานะงาน<select value={filter} onChange={e=>select(e.target.value)}><option value="">ทุกสถานะ</option>{labels.slice(0,6).map((l,i)=><option key={l} value={i}>{l}</option>)}</select></label>}
                {mine && !judge && <label>บทบาทของฉัน<select value={roleFilter} onChange={e=>setRoleFilter(e.target.value)}><option value="">ทุกบทบาท</option><option>ผู้ว่าจ้าง</option><option>ฟรีแลนซ์</option></select></label>}
                {(query || filter || roleFilter) && <button onClick={()=>{search("");select("");setRoleFilter("")}}>ล้างตัวกรอง</button>}
              </div>}
              <h2 aria-live="polite">{dispute?"รอพิจารณา":"รายการงาน"} · {list.length}</h2>
              {list.map((j) => (
                <a className="jobrow" key={j.id} href={"#/jobs/" + j.id}>
                  <div>
                    <small>
                      งาน #{j.id} · {role(j)}
                    </small>
                    <h3>{j.title}</h3>
                    <small>กำหนดส่ง {date(j.deadline)}</small>
                  </div>
                  <strong>{eth(j.wage)} ETH</strong>
                  <Badge n={j.status} />
                </a>
              ))}
              {!account ? <p>เชื่อม MetaMask เพื่อดูงานของบัญชีคุณ</p> : !list.length && <p>{filter || query || roleFilter ? "ไม่พบงานที่ตรงกับตัวกรอง" : "ยังไม่มีงานในรายการนี้"}</p>}
            </section>
          </>
        ) : (
          <p>
            ไม่พบงานหรือหน้าที่ระบุ <a href="#/">กลับรายการงาน</a>
          </p>
        )}
      </main>
      {action && (
        <dialog
          ref={reviewDialog}
          onCancel={() => ask(null)}
          aria-labelledby="confirm"
        >
          <h2 id="confirm">ตรวจทานรายการ</h2>
          <p>{action.title}</p>
          {action.amount !== undefined && (
            <p>
              จำนวน <strong>{eth(action.amount)} ETH</strong>
            </p>
          )}
          {action.recipient && (
            <p>
              ปลายทาง <code>{action.recipient}</code>
            </p>
          )}
          <p>
            บัญชีที่ส่ง <code>{account}</code>
          </p>
          <p>เครือข่าย {d?.name}</p>
          <div className="row">
            <button autoFocus onClick={() => ask(null)}>
              ยกเลิก
            </button>
            <button className="primary" disabled={!ready} onClick={transact}>
              ยืนยันในกระเป๋า
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}
type RequestAction = (action: Action) => void;
function Create({
  account,
  judge,
  now,
  ready,
  connect,
  ask,
}: {
  account: string;
  judge: string;
  now: number;
  ready: boolean;
  connect: () => void;
  ask: RequestAction;
}) {
  const [day,setDay]=useState(""), [time,setTime]=useState("17:00");
  function quickDay(days:number){
    const iso=new Date(Date.now()+(days*24+7)*3600000).toISOString().slice(0,10);
    setDay(iso);
  }
  const [error, set] = useState("");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const f = new FormData(e.currentTarget),
        val = (k: string) => String(f.get(k) || "").trim();
      let address:string; try {address=getAddress(val("address"))} catch {throw Error("ที่อยู่ฟรีแลนซ์ต้องขึ้นต้นด้วย 0x และมี 42 ตัวอักษร")}
      if ([account, judge, ZeroAddress].some((x) => same(x, address)))
        throw Error("กรุณาเลือกกระเป๋าฟรีแลนซ์ที่แยกจากผู้ว่าจ้างและผู้ดูแล");
      if (!/^\d+(\.\d{1,18})?$/.test(val("eth")))
        throw Error("ระบุ ETH เป็นจำนวนบวก ทศนิยมไม่เกิน 18 ตำแหน่ง");
      const wage = parseEther(val("eth")),
        iso=day,
        end=Date.parse(iso+"T"+time+":00+07:00")/1000;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)||!/^([01]\d|2[0-3]):00$/.test(time)||!Number.isFinite(end)||new Date((end+7*3600)*1000).toISOString().slice(0,10)!==iso) throw Error("ตรวจวันที่และเวลา เช่น 25/11/2026 เวลา 17:00");
      if(end<=Math.max(now,Date.now()/1000)) throw Error("กำหนดส่งต้องอยู่ในอนาคต");
      if (
        !val("title") ||
        !val("description") ||
        wage <= 0n ||
        !Number.isFinite(end) ||
        end <= Math.max(now, Date.now() / 1000)
      )
        throw Error("ตรวจชื่อ รายละเอียด ค่าจ้าง และกำหนดส่งในอนาคต");
      set("");
      ask({
        title: "สร้างข้อตกลง · " + val("title") + " · ค่าจ้าง " + eth(wage) + " ETH · ส่ง " + date(end) + " (เวลาไทย) · ฟรีแลนซ์ " + address,
        method: "createJob",
        args: [val("title"), val("description"), address, wage, end],
      });
    } catch (e) {
      set((e as Error).message);
    }
  }
  return (
    <>
      <a href="#/">← งานของฉัน</a>
      <h1>สร้างงาน</h1>
      <form className="card form" onSubmit={submit}>
        <h2>รายละเอียดข้อตกลง</h2>
        <label>ชื่อโครงการ<input required name="title" placeholder="เช่น ออกแบบหน้าแรกของเว็บไซต์"/></label>
        <label>รายละเอียดงาน<textarea required name="description" placeholder="ระบุสิ่งที่ต้องส่งมอบ"/></label>
        <label>กระเป๋าฟรีแลนซ์<input required name="address" spellCheck={false} placeholder="0x…" /></label>
        <label>ค่าจ้าง (Sepolia ETH)<input required inputMode="decimal" name="eth" placeholder="เช่น 0.001"/></label>
        <fieldset><legend>กำหนดส่ง · เวลาไทย</legend><div className="presets">
          {[1,3,7].map(days=><button key={days} type="button" onClick={()=>quickDay(days)}>{days===1?"พรุ่งนี้":"อีก "+days+" วัน"}</button>)}
        </div><div className="deadline"><label>วันที่ส่งงาน<input type="date" required name="day" min={new Date(Date.now()+7*3600000).toISOString().slice(0,10)} value={day} onChange={e=>setDay(e.target.value)}/></label>
        <label>เวลาส่งงาน<select name="time" value={time} onChange={e=>setTime(e.target.value)}>{Array.from({length:24},(_,hour)=>{const value=String(hour).padStart(2,"0")+":00";return <option key={value} value={value}>{value} น.</option>})}</select></label></div></fieldset>
        <small>รายละเอียดจะบันทึกบนบล็อกเชนและเปิดอ่านได้สาธารณะ</small>
        {error && <p role="alert">{error}</p>}
        {!account ? (
          <button type="button" onClick={connect}>
            เชื่อม MetaMask
          </button>
        ) : (
          <>
            <small>ผู้ว่าจ้าง {account}</small>
            <button
              className="primary"
              disabled={!ready || same(account, judge)}
            >
              ตรวจทานข้อตกลง
            </button>
          </>
        )}
      </form>
    </>
  );
}
function Detail({
  j,
  d,
  role,
  now,
  ready,
  ask,
  connect,
  account,
}: {
  j: Job;
  d: Deployment;
  role: string;
  now: number;
  ready: boolean;
  ask: RequestAction;
  connect: () => void;
  account: string;
}) {
  const [mode, set] = useState(""),
    [note, write] = useState(""),
    [decision, choose] = useState("0");
  const owner = role === "ผู้ว่าจ้าง",
    worker = role === "ฟรีแลนซ์",
    party = owner || worker,
    s = j.status,
    held = s >= 1 && s <= 3 ? j.wage : 0n;
  const btn = (title: string, method: string) => (
    <button
      disabled={!ready}
      className={method === "openDispute" ? "secondary" : "primary"}
      onClick={() => {
        if (["depositPayment", "approveAndRelease"].includes(method)) {
          ask({
            method,
            args: [j.id],
            title,
            amount: j.wage,
            value: method === "depositPayment" ? j.wage : 0n,
            recipient: method === "depositPayment" ? d.address : j.freelancer,
          });
        } else {
          set(method);
          write("");
        }
      }}
    >
      {title}
    </button>
  );
  const disputeAllowed =
    (owner &&
      ((s === 1 && now > j.deadline) || (s === 2 && now < j.reviewEnd))) ||
    (worker && s === 2 && now >= j.reviewEnd);
  const noteModes: Record<string, string> = {
    submitWork: "หลักฐานส่งมอบ (URL หรือ Hash)",
    openDispute: "เหตุผลที่เปิดข้อพิพาท",
    addEvidence: "หลักฐานหรือคำชี้แจง",
    resolveDispute: "เหตุผลของคำตัดสิน",
  };
  function submitNote(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    const resolving = mode === "resolveDispute";
    ask({
      method: mode,
      args: resolving
        ? [j.id, Number(decision), note.trim()]
        : [j.id, note.trim()],
      title: resolving
        ? decision === "0"
          ? "คืนเงินให้ผู้ว่าจ้าง"
          : "จ่ายเงินให้ฟรีแลนซ์"
        : noteModes[mode],
      ...(resolving
        ? {
            recipient: decision === "0" ? j.employer : j.freelancer,
            amount: j.wage,
          }
        : {}),
    });
    set("");
  }
  return (
    <>
      <div className="crumb">
        <a href="#/">งานของฉัน</a>　/　งาน #{j.id}
      </div>
      <h1>{j.title}</h1>
      <div className="subtitle">
        <Badge n={s} /> คุณเป็น{role}
      </div>
      <div className="layout">
        <article>
          <section className="card">
            <h2>ข้อตกลงการจ้าง</h2>
            <p>{j.description}</p>
            <dl>
              <dt>ค่าจ้างตามข้อตกลง</dt>
              <dd>{eth(j.wage)} ETH</dd>
              <dt>กำหนดส่ง (เวลาไทย)</dt>
              <dd>{date(j.deadline)}</dd>
              <dt>ผู้ว่าจ้าง</dt>
              <dd>
                <Token value={j.employer} />
              </dd>
              <dt>ฟรีแลนซ์</dt>
              <dd>
                {s===6?"รอผู้รับงาน":<Token value={j.freelancer} />}
              </dd>
            </dl>
          </section>
          <section className="card">
            <h2>หลักฐานที่ส่งมอบ</h2>
            {/^https?:\/\//i.test(j.evidence) ? (
              <a href={j.evidence} target="_blank" rel="noreferrer">
                เปิดหลักฐาน ↗
              </a>
            ) : (
              <p>{j.evidence || "ยังไม่มีการส่งงาน"}</p>
            )}
          </section>
        </article>
        <aside className="card">
          <h2>เงินที่พักอยู่ในสัญญา</h2>
          <div className="amount">
            {eth(held)} <small>ETH</small>
          </div>
          <p>
            ผู้รับเมื่อ{s === 5 ? "คืนเงิน" : "จ่าย"}　
            {s===6?"รอผู้รับงาน":<Token value={s === 5 ? j.employer : j.freelancer} />}
          </p>
          {s === 2 && <small>สิ้นสุดช่วงตรวจรับ {date(j.reviewEnd)}</small>}
          {s === 3 && <small>สิ้นสุดช่วงชี้แจง {date(j.responseEnd)}</small>}
          {s === 0 && now > j.deadline && <p>หมดเวลาฝากเงิน</p>}
          {!account && <button onClick={connect}>เชื่อม MetaMask</button>}
          {s === 0 &&
            owner &&
            now <= j.deadline &&
            btn("ฝาก " + eth(j.wage) + " ETH", "depositPayment")}
          {s === 1 &&
            worker &&
            now <= j.deadline &&
            btn("ส่งหลักฐานงาน", "submitWork")}
          {s === 2 &&
            owner &&
            btn("อนุมัติและจ่าย " + eth(j.wage) + " ETH", "approveAndRelease")}
          {disputeAllowed && btn("เปิดข้อพิพาท", "openDispute")}
          {s === 3 &&
            party &&
            now < j.responseEnd &&
            btn("เพิ่มหลักฐาน", "addEvidence")}
          {s === 3 &&
            role === "ผู้ดูแล" &&
            (now >= j.responseEnd || j.responded) &&
            btn("ตัดสินข้อพิพาท", "resolveDispute")}
          {s === 3 &&
            role === "ผู้ดูแล" &&
            !j.responded &&
            now < j.responseEnd && <p>รอคำชี้แจงของอีกฝ่าย</p>}
          {mode && (
            <form onSubmit={submitNote}>
              {mode === "resolveDispute" && (
                <label>
                  คำตัดสิน
                  <select
                    aria-label="คำตัดสิน"
                    value={decision}
                    onChange={(e) => choose(e.target.value)}
                  >
                    <option value="0">คืนผู้ว่าจ้างเต็มจำนวน</option>
                    <option value="1">จ่ายฟรีแลนซ์เต็มจำนวน</option>
                  </select>
                </label>
              )}
              <label>
                {noteModes[mode]}
                <textarea
                  required
                  value={note}
                  onChange={(e) => write(e.target.value)}
                />
              </label>
              <small>ข้อความจะเปิดอ่านได้สาธารณะ</small>
              <button disabled={!ready || !note.trim()}>ตรวจทานรายการ</button>
            </form>
          )}
        </aside>
      </div>
      <section className="card">
        <h2>ประวัติธุรกรรม</h2>
        {j.events.map((e) => (
          <div className="event" key={e.hash + e.name}>
            <div>
              <strong>
                {eventNames[e.name]}{" "}
                {e.amount !== undefined ? eth(e.amount) + " ETH" : ""}
              </strong>
              {e.text && <p>{e.text}</p>}
              {e.recipient && (
                <small>
                  ผู้รับ <Token value={e.recipient} />
                </small>
              )}
            </div>
            <div>
              <small>{date(e.time)}</small>
              <small>
                โดย <Token value={e.actor} />
              </small>
            </div>
            <div>
              <Token value={e.hash} />
              {d.explorer && (
                <a
                  href={d.explorer + "/tx/" + e.hash}
                  target="_blank"
                  rel="noreferrer"
                >
                  ดูธุรกรรม ↗
                </a>
              )}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
