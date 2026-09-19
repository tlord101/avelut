import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { NavItem, UserProfile, ChatConversation } from '../types';
import { navigationItems, adminNavigationItems } from '../constants';
import { Avatar } from './Avatar';
import { VerificationBadge } from './VerificationBadge';
import { useToast } from '../hooks/useToast';
import { deleteLocalConversation, getLocalMessages } from '../services/chatStorageService';
import { Capacitor } from '@capacitor/core';

// TEMPORARY RESTORE MARKER - full content will follow in next commit if truncated
export default function Sidebar() { return null; }
