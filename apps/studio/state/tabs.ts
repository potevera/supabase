import { ENTITY_TYPE } from 'data/entity-types/entity-type-constants'
import { NextRouter } from 'next/router'
import { ReactNode } from 'react'
import { proxy, subscribe, useSnapshot } from 'valtio'
import { addRecentItem } from './recent-items'

/**
 * [TODO REFACTOR] Joshen: JFYI this differs from the way that we usually write our stores
 * where we have contexts and such - ideally we need to refactor this for consistency
 * and the main benefit from our usual way of writing stores is that we do not need to pass
 * in the project ref to all the functions, as the stores are written to be scoped to the project
 *
 * So do not use this as reference for writing new valtio stores - refer to database-selector instead
 */

// Object mapping editor types to their corresponding tab types
export const editorEntityTypes = {
  table: ['r', 'v', 'm', 'f', 'p'],
  sql: ['sql'],
}

// Define the type of tabs available in the application
export type TabType = ENTITY_TYPE | 'sql'

type CreateTabIdParams = {
  r: { id: number }
  v: { id: number }
  m: { id: number }
  f: { id: number }
  p: { id: number }
  sql: { id: string }
  schema: { schema: string }
  view: never
  function: never
  new: never
}

export interface Tab {
  id: string // Unique identifier for the tab
  type: TabType // Type of the tab, which can be an entity type or specific string values
  label?: string // Optional label for the tab, displayed to the user
  icon?: ReactNode // Optional icon associated with the tab
  metadata?: {
    // Optional metadata related to the tab
    schema?: string // Optional schema name associated with the tab
    name?: string // Optional name of the entity represented by the tab
    tableId?: number // Optional ID of the table associated with the tab
    sqlId?: string // Optional ID of the SQL query associated with the tab
    scrollTop?: number // Optional scroll top of the tab (Currently just for SQL query)
  }
  isPreview?: boolean // Optional flag indicating if the tab is in preview mode
  createdAt?: Date // Optional timestamp for when the tab was created
  updatedAt?: Date // Optional timestamp for when the tab was last updated
}

// Interface representing the state of tabs
interface TabsState {
  activeTab: string | null
  openTabs: string[]
  tabsMap: { [key: string]: Tab }
  previewTabId?: string
}

// Map of tab states for different references
interface TabsStateMap {
  [ref: string]: TabsState
}

const STORAGE_KEY = 'supabase_studio_tabs'
const getStorageKey = (ref: string) => `${STORAGE_KEY}_${ref}`

const defaultState: TabsState = {
  openTabs: [],
  activeTab: null,
  tabsMap: {},
}

// Store now holds states for multiple refs
export const tabsStore = proxy<TabsStateMap>({})

// Helper to get/create state for a specific ref
export const getTabsStore = (ref?: string): TabsState => {
  if (!ref) return proxy(defaultState)
  if (!tabsStore[ref]) {
    const stored = localStorage.getItem(getStorageKey(ref))
    console.debug('[Tabs] Loading stored tabs:', stored)
    try {
      const parsed = stored ? JSON.parse(stored) : defaultState
      if (
        !parsed.openTabs ||
        !Array.isArray(parsed.openTabs) ||
        !parsed.tabsMap ||
        typeof parsed.tabsMap !== 'object'
      ) {
        console.warn('[Tabs] Invalid stored data, using default')
        tabsStore[ref] = proxy({ ...defaultState })
      } else {
        tabsStore[ref] = proxy(parsed)
      }
    } catch (error) {
      console.error('[Tabs] Failed to parse stored tabs:', error)
      tabsStore[ref] = proxy({ ...defaultState })
    }
  }

  return tabsStore[ref]
}

export const useTabsStore = (ref?: string) => {
  const store = getTabsStore(ref)
  return useSnapshot(store)
}

// Subscribe to changes for each ref and save to localStorage
if (typeof window !== 'undefined') {
  subscribe(tabsStore, () => {
    Object.entries(tabsStore).forEach(([ref, state]) => {
      try {
        localStorage.setItem(getStorageKey(ref), JSON.stringify(state))
      } catch (error) {
        console.error('Failed to save tabs to localStorage:', error)
      }
    })
  })
}

// Function to add a new tab to the store
export const addTab = (ref: string | undefined, tab: Tab) => {
  if (!ref) return
  const store = getTabsStore(ref)

  // If tab exists and is active, don't do anything
  if (store.tabsMap[tab.id] && store.activeTab === tab.id) {
    return
  }

  // If tab exists but isn't active, just make it active
  if (store.tabsMap[tab.id]) {
    store.activeTab = tab.id
    if (!tab.isPreview) addRecentItem(ref, tab)
    return
  }

  // If this tab should be permanent, add it normally
  if (tab.isPreview === false) {
    store.openTabs = [...store.openTabs, tab.id]
    store.tabsMap[tab.id] = tab
    store.activeTab = tab.id
    // Add to recent items when creating permanent tab
    addRecentItem(ref, tab)
    return
  }

  // Remove any existing preview tab
  if (store.previewTabId) {
    store.openTabs = store.openTabs.filter((id) => id !== store.previewTabId)
    delete store.tabsMap[store.previewTabId]
  }

  // Add new preview tab
  store.tabsMap[tab.id] = { ...tab, isPreview: true }
  store.openTabs = [...store.openTabs, tab.id]
  store.previewTabId = tab.id
  store.activeTab = tab.id
}

// Function to remove a tab from the store
// this is used for removing tabs from the localstorage state
// for handling a manual tab removal with a close action, use handleTabClose()
export const removeTab = (ref: string | undefined, id: string) => {
  const store = getTabsStore(ref)
  const idx = store.openTabs.indexOf(id)
  store.openTabs = store.openTabs.filter((tabId) => tabId !== id)
  delete store.tabsMap[id]

  // Update active tab if the removed tab was active
  if (id === store.activeTab) {
    store.activeTab = store.openTabs[idx - 1] || store.openTabs[idx + 1] || null
  }
}

// Function to remove multiple tabs from the store
// this is used for removing tabs from the localstorage state
// for handling a manual tab removal with a close action, use handleTabClose()
export const removeTabs = (ref: string | undefined, ids: string[]) => {
  if (!ref) return
  if (!ids.length) return

  ids.forEach((id) => removeTab(ref, id))
}

export const updateTab = (
  ref: string,
  id: string,
  updates: { label?: string; scrollTop?: number }
) => {
  const store = getTabsStore(ref)

  if (!!store.tabsMap[id]) {
    if ('label' in updates) {
      store.tabsMap[id].label = updates.label
    }
    if ('scrollTop' in updates && store.tabsMap[id].metadata) {
      store.tabsMap[id].metadata.scrollTop = updates.scrollTop
    }
  }
}

// Function to reorder tabs in the store
export const reorderTabs = (ref: string | undefined, oldIndex: number, newIndex: number) => {
  if (!ref) return
  const store = getTabsStore(ref)
  const newOpenTabs = [...store.openTabs]
  const [removedTab] = newOpenTabs.splice(oldIndex, 1)
  newOpenTabs.splice(newIndex, 0, removedTab)
  store.openTabs = newOpenTabs
}

// Function to make a tab permanent
export const makeTabPermanent = (ref: string | undefined, tabId: string) => {
  if (!ref) return
  const store = getTabsStore(ref)
  const tab = store.tabsMap[tabId]

  if (tab?.isPreview) {
    tab.isPreview = false
    store.previewTabId = undefined
    // Add to recent items when preview tab becomes permanent
    addRecentItem(ref, tab)
  }
}

// make the active tab permanent if it is a preview
export const makeActiveTabPermanent = (ref?: string) => {
  if (!ref) return false
  const store = getTabsStore(ref)

  if (store.activeTab && store.tabsMap[store.activeTab]?.isPreview) {
    makeTabPermanent(ref, store.activeTab)
    return true
  }
  return false
}

// handle navigation to a specific tab
export const handleTabNavigation = (ref: string | undefined, id: string, router: NextRouter) => {
  if (!ref) return

  const store = getTabsStore(ref)
  const tab = store.tabsMap[id]
  if (!tab) return

  store.activeTab = id

  // Add to recent items when navigating to a non-preview, non-new tab
  if (!tab.isPreview) addRecentItem(ref, tab)

  switch (tab.type) {
    case 'sql':
      const schema = (router.query.schema as string) || 'public'
      router.push(`/project/${router.query.ref}/sql/${tab.metadata?.sqlId}?schema=${schema}`)
      break
    case 'r':
    case 'v':
    case 'm':
    case 'f':
    case 'p':
      router.push(
        `/project/${router.query.ref}/editor/${tab.metadata?.tableId}?schema=${tab.metadata?.schema}`
      )
      break
  }
}

// Function to handle closing a tab
export const handleTabClose = ({
  ref,
  id,
  router,
  editor,
  onClose,
  onClearDashboardHistory,
}: {
  ref: string | undefined
  id: string
  router: NextRouter
  editor?: 'sql' | 'table'
  onClose?: (id: string) => void
  onClearDashboardHistory: () => void
}) => {
  if (!ref) return

  const store = getTabsStore(ref)
  const tabBeingClosed = store.tabsMap[id]
  const tabsAfterClosing = Object.values(store.tabsMap).filter((tab) => tab.id !== id)

  const nextTabId = !editor
    ? undefined
    : tabsAfterClosing.filter((tab) => {
        return editorEntityTypes[editor]?.includes(tab.type)
      })[0]?.id

  const { [id]: value, ...otherTabs } = store.tabsMap
  store.tabsMap = otherTabs

  if (tabBeingClosed) {
    const updatedOpenTabs = [...store.openTabs].filter((x) => x !== id)
    store.openTabs = updatedOpenTabs
  }

  // Remove the preview tab if it matches the tab being closed
  if (store.previewTabId === id) {
    store.previewTabId = undefined
  }

  // [Joshen] Only navigate away if we're closing the tab that's currently in focus
  if (store.activeTab === id || id === 'new') {
    if (nextTabId) {
      store.activeTab = nextTabId
      handleTabNavigation(ref, nextTabId, router)
    } else {
      onClearDashboardHistory()

      // If no tabs of same type, go to the home of the current section
      switch (tabBeingClosed?.type) {
        case 'sql':
          router.push(`/project/${router.query.ref}/sql`)
          break
        case 'r':
        case 'v':
        case 'm':
        case 'f':
        case 'p':
          router.push(`/project/${router.query.ref}/editor`)
          break
        default:
          router.push(`/project/${router.query.ref}/${editor}`)
      }
    }
  }

  onClose?.(id)
}

// Function to handle the end of a tab drag event
export const handleTabDragEnd = (
  ref: string | undefined,
  oldIndex: number,
  newIndex: number,
  tabId: string,
  router: any
) => {
  if (!ref) return
  const store = getTabsStore(ref)
  // Make permanent if needed
  const draggedTab = store.tabsMap[tabId]
  if (draggedTab?.isPreview) {
    makeTabPermanent(ref, tabId)
  }

  // Reorder tabs
  const newOpenTabs = [...store.openTabs]
  newOpenTabs.splice(oldIndex, 1)
  newOpenTabs.splice(newIndex, 0, tabId)

  store.openTabs = newOpenTabs
  store.activeTab = tabId

  // Handle navigation
  handleTabNavigation(ref, tabId, router)
}

// Function to create a unique tab ID based on type and parameters
export function createTabId<T extends TabType>(type: T, params: CreateTabIdParams[T]): string {
  switch (type) {
    case 'r':
      return `r-${(params as CreateTabIdParams['r']).id}`
    case 'v':
      return `v-${(params as CreateTabIdParams['v']).id}`
    case 'm':
      return `m-${(params as CreateTabIdParams['m']).id}`
    case 'f':
      return `f-${(params as CreateTabIdParams['f']).id}`
    case 'p':
      return `p-${(params as CreateTabIdParams['p']).id}`
    case 'sql':
      return `sql-${(params as CreateTabIdParams['sql']).id}`
    default:
      return ''
  }
}

// Function to remove tabs based on their editor type
export function removeTabsByEditor(ref: string | undefined, type: 'table' | 'sql') {
  if (!ref) return
  const store = getTabsStore(ref)

  // Get tab IDs to remove
  const tabIdsToRemove = store.openTabs.filter((id) => {
    return editorEntityTypes[type].some((entityType) => id.startsWith(`${entityType}-`))
  })

  removeTabs(ref, tabIdsToRemove)
}
