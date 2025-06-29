import React, { createContext, useContext, useReducer, useEffect } from 'react';
import socketService from '../services/socketService';
import type { ViewerInfo, FileViewers } from '../types/viewing';
import { useAuth } from './AuthContext';

interface ViewingState {
  fileViewers: Map<string, FileViewers>;
  currentlyViewing: string | null;
}

type ViewingAction =
  | {
      type: 'SET_FILE_VIEWERS';
      payload: { fileId: string; viewers: ViewerInfo[] };
    }
  | {
      type: 'USER_STARTED_VIEWING';
      payload: { fileId: string; viewer: ViewerInfo };
    }
  | {
      type: 'USER_STOPPED_VIEWING';
      payload: { fileId: string; userId: string };
    }
  | { type: 'SET_CURRENTLY_VIEWING'; payload: string | null }
  | { type: 'CLEAR_FILE_VIEWERS'; payload: string };

const initialState: ViewingState = {
  fileViewers: new Map(),
  currentlyViewing: null,
};

function viewingReducer(
  state: ViewingState,
  action: ViewingAction
): ViewingState {
  switch (action.type) {
    case 'SET_FILE_VIEWERS': {
      const { fileId, viewers } = action.payload;
      const newFileViewers = new Map(state.fileViewers);
      newFileViewers.set(fileId, {
        fileId,
        viewers,
        lastUpdated: new Date(),
      });
      return { ...state, fileViewers: newFileViewers };
    }

    case 'USER_STARTED_VIEWING': {
      const { fileId, viewer } = action.payload;
      const newFileViewers = new Map(state.fileViewers);
      const currentViewers = newFileViewers.get(fileId) || {
        fileId,
        viewers: [],
        lastUpdated: new Date(),
      };

      // Add viewer if not already present
      const existingViewerIndex = currentViewers.viewers.findIndex(
        (v) => v.id === viewer.id
      );
      if (existingViewerIndex === -1) {
        currentViewers.viewers.push(viewer);
      } else {
        currentViewers.viewers[existingViewerIndex] = viewer;
      }

      currentViewers.lastUpdated = new Date();
      newFileViewers.set(fileId, currentViewers);
      return { ...state, fileViewers: newFileViewers };
    }

    case 'USER_STOPPED_VIEWING': {
      const { fileId, userId } = action.payload;
      const newFileViewers = new Map(state.fileViewers);
      const currentViewers = newFileViewers.get(fileId);

      if (currentViewers) {
        currentViewers.viewers = currentViewers.viewers.filter(
          (v) => v.id !== userId
        );
        currentViewers.lastUpdated = new Date();

        if (currentViewers.viewers.length === 0) {
          newFileViewers.delete(fileId);
        } else {
          newFileViewers.set(fileId, currentViewers);
        }
      }

      return { ...state, fileViewers: newFileViewers };
    }

    case 'SET_CURRENTLY_VIEWING':
      return { ...state, currentlyViewing: action.payload };

    case 'CLEAR_FILE_VIEWERS': {
      const newFileViewers = new Map(state.fileViewers);
      newFileViewers.delete(action.payload);
      return { ...state, fileViewers: newFileViewers };
    }

    default:
      return state;
  }
}

interface ViewingContextType {
  state: ViewingState;
  startViewing: (fileId: string) => void;
  stopViewing: (fileId: string) => void;
  getFileViewers: (fileId: string) => ViewerInfo[];
  isCurrentlyViewing: (fileId: string) => boolean;
  getCurrentViewersCount: (fileId: string) => number;
}

const ViewingContext = createContext<ViewingContextType | undefined>(undefined);

export const useViewing = () => {
  const context = useContext(ViewingContext);
  if (!context) {
    throw new Error('useViewing must be used within a ViewingProvider');
  }
  return context;
};

interface ViewingProviderProps {
  children: React.ReactNode;
}

export const ViewingProvider: React.FC<ViewingProviderProps> = ({
  children,
}) => {
  const [state, dispatch] = useReducer(viewingReducer, initialState);
  const { user, token } = useAuth();

  // Connect socket when user is authenticated
  useEffect(() => {
    console.log('🔌 ViewingProvider: Setting up socket connection...');

    if (user && token) {
      socketService.connect(token);
    }

    return () => {
      console.log('🔌 ViewingProvider cleanup...');
      if (state.currentlyViewing) {
        socketService.stopViewingFile(state.currentlyViewing);
      }
      socketService.disconnect();
    };
  }, [user, token]);

  // Socket event listeners
  useEffect(() => {
    console.log('🎧 Setting up viewing event listeners...');

    // Only set up listeners if socket is connected
    if (!socketService.connected) {
      console.log('⚠️ Socket not connected yet, waiting...');
      return;
    }

    // Define handlers with proper logging
    const handleFileViewersUpdated = (data: {
      fileId: string;
      viewers: ViewerInfo[];
    }) => {
      console.log(
        '📨 ViewingContext received file-viewers-updated:-----------------------',
        data
      );
      dispatch({ type: 'SET_FILE_VIEWERS', payload: data });
    };

    const handleUserStartedViewing = (data: {
      fileId: string;
      viewer: ViewerInfo;
    }) => {
      console.log(
        '📨 ViewingContext received user-started-viewing-file:',
        data
      );
      dispatch({ type: 'USER_STARTED_VIEWING', payload: data });
    };

    const handleUserStoppedViewing = (data: {
      fileId: string;
      userId: string;
    }) => {
      console.log(
        '📨 ViewingContext received user-stopped-viewing-file:',
        data
      );
      dispatch({ type: 'USER_STOPPED_VIEWING', payload: data });
    };

    // Register listeners
    socketService.on('file-viewers-updated', handleFileViewersUpdated);
    socketService.on('user-started-viewing-file', handleUserStartedViewing);
    socketService.on('user-stopped-viewing-file', handleUserStoppedViewing);

    return () => {
      console.log('🎧 Cleaning up viewing event listeners...');
      socketService.off('file-viewers-updated', handleFileViewersUpdated);
      socketService.off('user-started-viewing-file', handleUserStartedViewing);
      socketService.off('user-stopped-viewing-file', handleUserStoppedViewing);
    };
  }, [socketService.connected]); // Add dependency on socket connection status

  const startViewing = (fileId: string) => {
    // Stop viewing current file if any
    if (state.currentlyViewing && state.currentlyViewing !== fileId) {
      socketService.stopViewingFile(state.currentlyViewing);
    }

    socketService.startViewingFile(fileId);
    dispatch({ type: 'SET_CURRENTLY_VIEWING', payload: fileId });
  };

  const stopViewing = (fileId: string) => {
    socketService.stopViewingFile(fileId);
    if (state.currentlyViewing === fileId) {
      dispatch({ type: 'SET_CURRENTLY_VIEWING', payload: null });
    }
  };

  const getFileViewers = (fileId: string): ViewerInfo[] => {
    return state.fileViewers.get(fileId)?.viewers || [];
  };

  const isCurrentlyViewing = (fileId: string): boolean => {
    return state.currentlyViewing === fileId;
  };

  const getCurrentViewersCount = (fileId: string): number => {
    return state.fileViewers.get(fileId)?.viewers.length || 0;
  };

  return (
    <ViewingContext.Provider
      value={{
        state,
        startViewing,
        stopViewing,
        getFileViewers,
        isCurrentlyViewing,
        getCurrentViewersCount,
      }}
    >
      {children}
    </ViewingContext.Provider>
  );
};
