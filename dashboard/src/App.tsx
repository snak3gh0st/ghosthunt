import {BrowserRouter,Routes,Route,Navigate} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {Toaster} from 'sonner';
import LoginPage from './pages/LoginPage';
import {BountyLayout} from './bounty/shared';
import CommandCenter from './bounty/CommandCenter';
import Overview from './bounty/Overview';
import Programs from './bounty/Programs';
import ProgramDetail from './bounty/ProgramDetail';
import Findings from './bounty/Findings';
import FindingDetail from './bounty/FindingDetail';
import Integrations from './bounty/Integrations';
const client=new QueryClient({defaultOptions:{queries:{retry:1,refetchOnWindowFocus:false}}});
function Auth({children}:{children:React.ReactNode}){return localStorage.getItem('ghosthunt_api_key')?<>{children}</>:<Navigate to="/login" replace/>;}
export default function App(){return <QueryClientProvider client={client}><Toaster theme="dark" position="bottom-right"/><BrowserRouter><Routes><Route path="/login" element={<LoginPage/>}/><Route element={<Auth><BountyLayout/></Auth>}><Route path="/" element={<CommandCenter/>}/><Route path="/operations" element={<CommandCenter/>}/><Route path="/overview" element={<Overview/>}/><Route path="/programs" element={<Programs/>}/><Route path="/programs/:id" element={<ProgramDetail/>}/><Route path="/findings" element={<Findings/>}/><Route path="/findings/:id" element={<FindingDetail/>}/><Route path="/integrations" element={<Integrations/>}/></Route><Route path="*" element={<Navigate to="/" replace/>}/></Routes></BrowserRouter></QueryClientProvider>}
