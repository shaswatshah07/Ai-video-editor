import React from 'react';
import { useEditorStore } from './store/useEditorStore';
import { Screen1Upload } from './components/Screen1Upload';
import { Screen2Workspace } from './components/Screen2Workspace';
import { Screen3Export } from './components/Screen3Export';

export const App: React.FC = () => {
  const { screen } = useEditorStore();

  return (
    <div className="min-h-screen bg-[#0E0E0D] text-[#F4F2EE]">
      {screen === 'UPLOAD' && <Screen1Upload />}
      {screen === 'WORKSPACE' && <Screen2Workspace />}
      {screen === 'EXPORT' && <Screen3Export />}
    </div>
  );
};

export default App;
