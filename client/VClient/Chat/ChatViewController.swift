import SwiftUI
import UIKit

/// What is being written in one chat.
@MainActor @Observable
final class ChatDraft {
    var text = ""
    var quote: String?
    var attachments: [Attachment] = []
}

/// The message list and the composer of one chat.
///
/// A table view, not a lazy stack: it knows where every row is before drawing
/// it, so it can open at the newest message, hold the reader's place while
/// older pages arrive above, and move with the keyboard on the keyboard's own
/// curve. Rows are still the SwiftUI message views.
struct ChatList: UIViewControllerRepresentable {
    let model: AppModel
    let session: ChatSession
    let draft: ChatDraft
    let loadingEarlier: Bool
    let earlierFailed: Bool
    let actions: MessageActions
    let openURL: (URL) -> OpenURLAction.Result

    func makeUIViewController(context: Context) -> ChatListController {
        ChatListController(model: model, sessionID: session.id, draft: draft)
    }

    func updateUIViewController(_ controller: ChatListController, context: Context) {
        controller.actions = actions
        controller.openURL = openURL
        controller.show(session, loadingEarlier: loadingEarlier, earlierFailed: earlierFailed)
    }
}

final class ChatListController: UIViewController, UITableViewDelegate {
    struct Row: Equatable {
        var item: ChatItem
        var showsTime: Bool
        var showsSender: Bool
    }

    /// The row above the oldest message, while there is more to read.
    enum Earlier: Equatable { case none, idle, loading, failed }

    static let earlierID = "__earlier"
    /// Space between the newest message and the composer.
    private static let tailGap: CGFloat = 10

    var actions = MessageActions()
    var openURL: (URL) -> OpenURLAction.Result = { _ in .systemAction }

    private let model: AppModel
    private let sessionID: String
    private let draft: ChatDraft

    private let table = UITableView(frame: .zero, style: .plain)
    private var source: UITableViewDiffableDataSource<Int, String>!
    private var composer: UIHostingController<AnyView>!
    private var composerHeight: NSLayoutConstraint!
    private let jump = UIButton(type: .system)
    private var sizeObservation: NSKeyValueObservation?

    private var rows: [String: Row] = [:]
    private var order: [String] = []
    private var earlier = Earlier.none
    private var heights: [String: CGFloat] = [:]
    private var historyLoaded = false
    /// Following the newest message. Only the reader's own scrolling, sending,
    /// or the jump button changes it; content growing never does.
    private var pinned = true
    /// Messages that arrived while the reader was further up.
    private var unseen = 0
    /// The list has been put at the newest message for the first time.
    private var placed = false
    private var applying = false
    /// Runs while the list is on its way to the newest message.
    private var glide: CADisplayLink?
    private var glideSpeed: CGFloat = 0
    private var glideTime: CFTimeInterval = 0
    private var askedForEarlier = false
    private var laidOutWidth: CGFloat = 0

    init(model: AppModel, sessionID: String, draft: ChatDraft) {
        self.model = model
        self.sessionID = sessionID
        self.draft = draft
        super.init(nibName: nil, bundle: nil)
        draft.text = model.drafts[sessionID] ?? ""
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    // MARK: View

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(VTheme.page)

        table.translatesAutoresizingMaskIntoConstraints = false
        table.backgroundColor = .clear
        table.separatorStyle = .none
        table.allowsSelection = false
        table.keyboardDismissMode = .interactive
        table.rowHeight = UITableView.automaticDimension
        table.sectionHeaderTopPadding = 0
        table.contentInsetAdjustmentBehavior = .automatic
        table.delegate = self
        table.accessibilityIdentifier = "chatList"
        table.register(UITableViewCell.self, forCellReuseIdentifier: "row")
        table.register(UITableViewCell.self, forCellReuseIdentifier: "earlier")
        view.addSubview(table)

        source = UITableViewDiffableDataSource<Int, String>(tableView: table) { [weak self] table, indexPath, id in
            let cell = table.dequeueReusableCell(withIdentifier: id == Self.earlierID ? "earlier" : "row", for: indexPath)
            cell.backgroundConfiguration = .clear()
            cell.selectionStyle = .none
            self?.configure(cell, id: id)
            return cell
        }
        source.defaultRowAnimation = .none

        let bar = ComposerBar(sessionID: sessionID, draft: draft)
            .environment(model)
            .tint(VTheme.purple)
        composer = UIHostingController(rootView: AnyView(bar))
        composer.safeAreaRegions = []
        composer.sizingOptions = [.intrinsicContentSize]
        composer.view.backgroundColor = .clear
        composer.view.translatesAutoresizingMaskIntoConstraints = false
        addChild(composer)
        view.addSubview(composer.view)
        composer.didMove(toParent: self)
        composerHeight = composer.view.heightAnchor.constraint(equalToConstant: 60)

        var look = UIButton.Configuration.glass()
        look.cornerStyle = .capsule
        look.image = UIImage(systemName: "chevron.down",
                             withConfiguration: UIImage.SymbolConfiguration(pointSize: 13, weight: .semibold))
        look.imagePadding = 4
        look.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 12, bottom: 0, trailing: 12)
        jump.configuration = look
        jump.translatesAutoresizingMaskIntoConstraints = false
        jump.accessibilityIdentifier = "jumpToLatest"
        jump.alpha = 0
        jump.isHidden = true
        jump.addAction(UIAction { [weak self] _ in self?.jumpToLatest() }, for: .primaryActionTriggered)
        view.addSubview(jump)

        NSLayoutConstraint.activate([
            table.topAnchor.constraint(equalTo: view.topAnchor),
            table.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            table.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            table.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            composer.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            composer.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            // The keyboard's own guide: the bar rides the keyboard, frame by frame,
            // including while a finger drags it down.
            composer.view.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            composerHeight,
            jump.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -14),
            jump.bottomAnchor.constraint(equalTo: composer.view.topAnchor, constant: -8),
            jump.heightAnchor.constraint(equalToConstant: 44),
            jump.widthAnchor.constraint(greaterThanOrEqualToConstant: 44),
        ])

        let tap = UITapGestureRecognizer(target: self, action: #selector(tappedList))
        tap.cancelsTouchesInView = false
        table.addGestureRecognizer(tap)

        sizeObservation = table.observe(\.contentSize) { [weak self] _, _ in
            MainActor.assumeIsolated { self?.contentSizeChanged() }
        }
    }

    override func viewIsAppearing(_ animated: Bool) {
        super.viewIsAppearing(animated)
        guard !placed else { return }
        view.layoutIfNeeded()
        fitComposer()
        // The rows go in only now, with the list already at its end, so the
        // first cells made are the ones on screen and not the oldest messages.
        applying = true
        UIView.performWithoutAnimation {
            applySnapshot()
            if let last = order.last, let path = source.indexPath(for: last) {
                table.scrollToRow(at: path, at: .bottom, animated: false)
            }
        }
        applying = false
        placed = true
        settleAtBottom()
        loadEarlierIfNear()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        fitComposer()
        if placed, pinned, abs(laidOutWidth - view.bounds.width) > 0.5, !table.isTracking {
            // Rotated or resized: every row has a new height.
            heights.removeAll()
            settleAtBottom()
        }
        laidOutWidth = view.bounds.width
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        if placed, pinned, !table.isTracking { settleAtBottom() }
    }

    @objc private func tappedList() {
        view.endEditing(true)
    }

    // MARK: Rows

    private func configure(_ cell: UITableViewCell, id: String) {
        if id == Self.earlierID {
            cell.contentConfiguration = UIHostingConfiguration {
                EarlierRow(state: earlier) { [weak self] in
                    guard let self else { return }
                    model.loadEarlier(sessionID)
                }
                .tint(VTheme.purple)
            }
            .margins(.all, 0)
            .minSize(width: 0, height: 0)
            return
        }
        guard let row = rows[id] else { return }
        cell.contentConfiguration = UIHostingConfiguration {
            ChatRowView(row: row, sessionID: sessionID, canReact: sessionID == model.vappSessionID)
                .environment(model)
                .environment(\.messageActions, MessageActions(
                    quote: { [weak self] in self?.actions.quote($0) },
                    select: { [weak self] in self?.actions.select($0) }))
                .environment(\.openURL, OpenURLAction { [weak self] url in self?.openURL(url) ?? .systemAction })
                .tint(VTheme.purple)
        }
        .margins(.all, 0)
        .minSize(width: 0, height: 0)
    }

    /// Gives rows their new content and, in the same step, their new height.
    ///
    /// Left alone, the table resizes a changed row a moment later and with its
    /// own animation, while the list has already moved to the new end: the
    /// newest message then bounces on every streamed line. Here the height and
    /// the position change together. A reply that folds up when it finishes
    /// eases down on the same spring the card uses.
    private func reconfigure(_ ids: [String]) {
        var touched = false
        var folds = false
        for id in ids {
            guard let path = source.indexPath(for: id), let cell = table.cellForRow(at: path) else {
                heights[id] = nil
                continue
            }
            let before = cell.bounds.height
            configure(cell, id: id)
            touched = true
            let fit = fittingHeight(cell)
            if id != Self.earlierID, before - fit > 40 { folds = true }
        }
        guard touched, placed, !applying else { return }
        let start = table.contentOffset.y
        // The table passes through heights of its own while it works this out,
        // and puts the list back where it was when it is done. Following along
        // is for afterwards.
        applying = true
        UIView.performWithoutAnimation {
            table.performBatchUpdates(nil)
            table.layoutIfNeeded()
        }
        applying = false
        guard pinned, !table.isTracking, !table.isDecelerating else { return }
        let end = maxOffsetY
        guard folds, view.window != nil, start - end > 1 else { return contentSizeChanged() }
        // A reply folding up: the row is short already. Ease the list down to
        // its new end rather than dropping everything above by the difference.
        // The table has put the list at its new end already; start from where
        // it was. An animation rather than `glideToBottom`, because the table
        // will not leave the list past its end between frames.
        stopGlide()
        UIView.performWithoutAnimation { table.contentOffset.y = start }
        UIView.animate(springDuration: WorkCardView.foldDuration, bounce: 0, options: [.allowUserInteraction]) {
            self.table.contentOffset.y = end
        }
    }

    private func fittingHeight(_ cell: UITableViewCell) -> CGFloat {
        cell.systemLayoutSizeFitting(
            CGSize(width: table.bounds.width, height: UIView.layoutFittingCompressedSize.height),
            withHorizontalFittingPriority: .required,
            verticalFittingPriority: .fittingSizeLevel).height
    }

    /// Takes the chat as it is now. Called on every change to it, so the common
    /// case (one message's text grew) touches one cell and nothing else.
    func show(_ session: ChatSession, loadingEarlier: Bool, earlierFailed: Bool) {
        loadViewIfNeeded()
        var newRows: [String: Row] = [:]
        var newOrder: [String] = []
        newRows.reserveCapacity(session.items.count)
        newOrder.reserveCapacity(session.items.count)
        var previous: ChatItem?
        for item in session.items where newRows[item.id] == nil {
            let gap = previous.map { item.time.timeIntervalSince($0.time) > 600 } ?? true
            newRows[item.id] = Row(item: item, showsTime: gap, showsSender: gap || previous?.sender != item.sender)
            newOrder.append(item.id)
            previous = item
        }
        let newEarlier: Earlier = !session.hasMoreHistory ? .none : earlierFailed ? .failed : loadingEarlier ? .loading : .idle

        let changed = newOrder.filter { id in rows[id].map { $0 != newRows[id] } ?? false }
        let orderChanged = newOrder != order || (newEarlier == .none) != (earlier == .none)
        let earlierChanged = newEarlier != earlier
        let oldLast = order.last
        let wasEmpty = order.isEmpty
        let firstHistory = !historyLoaded && session.historyLoaded
        let appended = newOrder.last.map { rows[$0] == nil } ?? false
        let tailReplaced = oldLast.map { newRows[$0] == nil } ?? false

        rows = newRows
        order = newOrder
        earlier = newEarlier
        historyLoaded = session.historyLoaded

        // Until the list is on screen there is nothing to update: it takes the
        // rows as they are then.
        guard placed else { return }

        // Where the newest message sits now, to start from when more follow it.
        let tail = placed && pinned && appended ? oldLast.flatMap(place(of:)) : nil
        if orderChanged {
            let anchor = placed && !pinned ? readingPlace() : nil
            applying = true
            UIView.performWithoutAnimation {
                applySnapshot()
                reconfigure(changed)
                if earlierChanged { reconfigure([Self.earlierID]) }
                table.layoutIfNeeded()
                if let anchor { restore(anchor) }
            }
            applying = false
        } else {
            reconfigure(changed)
            if earlierChanged { reconfigure([Self.earlierID]) }
        }

        if appended {
            let mine = newOrder.last.flatMap { newRows[$0] }?.item.sender == .user
            let arrivedLive = !firstHistory && !wasEmpty
            if mine, arrivedLive { pinned = true }
            if pinned {
                unseen = 0
                // What was the newest stays where it was, and the list carries
                // the new ones up from under the composer.
                if let tail, !wasEmpty { restore(tail, clamped: false) }
                followToBottom()
            } else if arrivedLive, !tailReplaced {
                unseen += 1
            }
        } else if pinned, orderChanged {
            settleAtBottom()
        }
        updateJump()
        loadEarlierIfNear()
    }

    // MARK: Position

    private var maxOffsetY: CGFloat {
        max(minOffsetY, table.contentSize.height - table.bounds.height + table.adjustedContentInset.bottom)
    }

    private var minOffsetY: CGFloat { -table.adjustedContentInset.top }

    private var distanceFromBottom: CGFloat { maxOffsetY - table.contentOffset.y }

    private struct Place {
        var id: String
        /// The row's bottom edge, measured from the top of what is on screen.
        var bottom: CGFloat
    }

    /// The first message on screen and where it sits, to put it back after rows
    /// are added above it.
    private func applySnapshot() {
        var snapshot = NSDiffableDataSourceSnapshot<Int, String>()
        snapshot.appendSections([0])
        if earlier != .none { snapshot.appendItems([Self.earlierID]) }
        snapshot.appendItems(order)
        source.apply(snapshot, animatingDifferences: false)
    }

    private func readingPlace() -> Place? {
        for path in table.indexPathsForVisibleRows ?? [] {
            guard let id = source.itemIdentifier(for: path), id != Self.earlierID else { continue }
            return Place(id: id, bottom: table.rectForRow(at: path).maxY - table.contentOffset.y)
        }
        return nil
    }

    private func place(of id: String) -> Place? {
        guard let path = source.indexPath(for: id) else { return nil }
        return Place(id: id, bottom: table.rectForRow(at: path).maxY - table.contentOffset.y)
    }

    private func restore(_ place: Place, clamped: Bool = true) {
        guard let path = source.indexPath(for: place.id) else { return }
        let y = table.rectForRow(at: path).maxY - place.bottom
        let was = applying
        applying = true
        UIView.performWithoutAnimation {
            table.contentOffset.y = clamped ? min(max(y, minOffsetY), maxOffsetY) : max(y, minOffsetY)
        }
        applying = was
    }

    /// At the newest message, now. Rows near the end are measured as they come
    /// into reach, which moves the end, so this repeats until it holds.
    private func settleAtBottom() {
        stopGlide()
        UIView.performWithoutAnimation {
            for _ in 0..<8 {
                table.layoutIfNeeded()
                let target = maxOffsetY
                if abs(table.contentOffset.y - target) < 0.05 { break }
                table.contentOffset.y = target
            }
        }
    }

    /// To the newest message, carried there when it is close enough to watch.
    private func followToBottom() {
        applying = true
        UIView.performWithoutAnimation { table.layoutIfNeeded() }
        applying = false
        let distance = distanceFromBottom
        guard view.window != nil, !UIAccessibility.isReduceMotionEnabled,
              abs(distance) > 1, abs(distance) < table.bounds.height * 1.5
        else { return settleAtBottom() }
        glideToBottom()
    }

    private func jumpToLatest() {
        pinned = true
        unseen = 0
        if distanceFromBottom > table.bounds.height * 1.5 {
            // From far up: arrive just above the end and glide the last stretch.
            settleAtBottom()
            UIView.performWithoutAnimation {
                table.contentOffset.y = max(minOffsetY, maxOffsetY - 240)
                table.layoutIfNeeded()
            }
        }
        glideToBottom()
        updateJump()
    }

    /// Eases the list to its end, wherever the end is by then: rows are measured
    /// as they come into reach and a reply keeps growing, so the end moves while
    /// the list is on its way. A fixed animation to where the end was would stop
    /// short of it; this one is aimed again on every frame.
    private func glideToBottom() {
        guard glide == nil else { return }
        guard view.window != nil, !UIAccessibility.isReduceMotionEnabled else { return settleAtBottom() }
        glideSpeed = 0
        glideTime = 0
        let link = CADisplayLink(target: self, selector: #selector(glideStep(_:)))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 80, maximum: 120, preferred: 120)
        link.add(to: .main, forMode: .common)
        glide = link
    }

    private func stopGlide() {
        glide?.invalidate()
        glide = nil
    }

    @objc private func glideStep(_ link: CADisplayLink) {
        guard pinned, !table.isTracking, view.window != nil else { return stopGlide() }
        let step = glideTime == 0 ? link.duration : min(link.targetTimestamp - glideTime, 1.0 / 30)
        glideTime = link.targetTimestamp
        // A critically damped spring: no overshoot, and it keeps its speed when
        // the end moves under it.
        let stiffness = 2 * CGFloat.pi / Self.glideResponse
        let target = maxOffsetY
        let away = table.contentOffset.y - target
        let pull = glideSpeed + stiffness * away
        let decay = exp(-stiffness * step)
        let next = (away + pull * step) * decay
        glideSpeed = (glideSpeed - stiffness * pull * step) * decay
        if abs(next) < 0.3, abs(glideSpeed) < 30 {
            stopGlide()
            settleAtBottom()
            updateJump()
        } else {
            table.contentOffset.y = target + next
        }
    }

    static let glideResponse: CGFloat = 0.32

    /// A row changed height: text streaming in, a picture arriving, a card
    /// opening. A reader at the newest message stays there.
    private func contentSizeChanged() {
        guard placed, !applying, pinned, !table.isTracking, !table.isDecelerating else { return }
        let target = maxOffsetY
        guard abs(table.contentOffset.y - target) > 0.5 else { return }
        // On its way there already, and aimed at wherever the end now is.
        guard glide == nil else { return }
        table.contentOffset.y = target
    }

    /// Sizes the composer and makes room for it (and the keyboard under it) at
    /// the end of the list. Runs inside the keyboard's animation, so the list
    /// moves with the keyboard, not after it.
    private func fitComposer() {
        let width = view.bounds.width
        guard width > 0 else { return }
        let fitted = composer.sizeThatFits(in: CGSize(width: width, height: .greatestFiniteMagnitude)).height
        if abs(composerHeight.constant - fitted) > 0.5 {
            composerHeight.constant = fitted
            view.layoutIfNeeded()
            return
        }
        let overlap = view.bounds.maxY - composer.view.frame.minY
        let bottom = max(0, overlap - view.safeAreaInsets.bottom) + Self.tailGap
        let delta = bottom - table.contentInset.bottom
        guard abs(delta) > 0.5 else { return }
        let before = table.contentOffset.y
        table.contentInset.bottom = bottom
        table.verticalScrollIndicatorInsets.bottom = bottom - Self.tailGap
        guard placed, !table.isTracking else { return }
        if pinned {
            table.contentOffset.y = maxOffsetY
        } else {
            // Reading further up: what was above the composer stays above it.
            table.contentOffset.y = min(max(before + delta, minOffsetY), maxOffsetY)
        }
    }

    private func updateJump() {
        let show = placed && !pinned && distanceFromBottom > 120
        var look = jump.configuration
        let title = unseen > 0 ? "\(unseen)" : nil
        if look?.title != title {
            look?.title = title
            look?.baseForegroundColor = UIColor(unseen > 0 ? VTheme.purple : VTheme.soft)
            look?.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
                var attributes = attributes
                attributes.font = UIFont.monospacedDigitSystemFont(ofSize: 13, weight: .semibold)
                return attributes
            }
            jump.configuration = look
            jump.accessibilityLabel = unseen > 0 ? "回到最新，\(unseen) 条新消息" : "回到最新"
        }
        guard show != !jump.isHidden || (show && jump.alpha < 1 && jump.layer.animationKeys() == nil) else { return }
        if show { jump.isHidden = false }
        UIView.animate(withDuration: 0.2, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
            self.jump.alpha = show ? 1 : 0
            self.jump.transform = show ? .identity : CGAffineTransform(scaleX: 0.8, y: 0.8)
        } completion: { _ in
            if !show, self.jump.alpha == 0 { self.jump.isHidden = true }
        }
    }

    private func loadEarlierIfNear() {
        guard placed, earlier == .idle, historyLoaded, !askedForEarlier else { return }
        guard table.contentOffset.y - minOffsetY < 700 else { return }
        askedForEarlier = true
        // Not from inside a view update.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            askedForEarlier = false
            model.loadEarlier(sessionID)
        }
    }

    // MARK: UITableViewDelegate

    func tableView(_ tableView: UITableView, estimatedHeightForRowAt indexPath: IndexPath) -> CGFloat {
        guard let id = source.itemIdentifier(for: indexPath) else { return 60 }
        if let height = heights[id] { return height }
        if id == Self.earlierID { return 44 }
        return rows[id].map { Self.estimate($0, width: tableView.bounds.width) } ?? 60
    }

    func tableView(_ tableView: UITableView, willDisplay cell: UITableViewCell, forRowAt indexPath: IndexPath) {
        if let id = source.itemIdentifier(for: indexPath) { heights[id] = cell.bounds.height }
    }

    func tableView(_ tableView: UITableView, didEndDisplaying cell: UITableViewCell, forRowAt indexPath: IndexPath) {
        // The height it ended with, pictures and all, for when it comes back.
        if indexPath.row < tableView.numberOfRows(inSection: 0), let id = source.itemIdentifier(for: indexPath) {
            heights[id] = cell.bounds.height
        }
    }

    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        stopGlide()
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        guard placed else { return }
        if scrollView.isTracking || scrollView.isDragging || scrollView.isDecelerating {
            let atBottom = distanceFromBottom < 40
            if atBottom != pinned {
                pinned = atBottom
                if atBottom { unseen = 0 }
            }
        }
        updateJump()
        loadEarlierIfNear()
    }

    func scrollViewDidScrollToTop(_ scrollView: UIScrollView) {
        pinned = false
        updateJump()
        loadEarlierIfNear()
    }

    /// A guess at a row's height before it is drawn, close enough that the
    /// scroll bar and the reader's place do not lurch when the real one is known.
    static func estimate(_ row: Row, width: CGFloat) -> CGFloat {
        let item = row.item
        var height: CGFloat = row.showsTime ? 44 : row.showsSender ? 16 : 6
        let text = item.plainText
        let visual = item.media.filter { $0.kind == .image || $0.kind == .video }.count
        let files = item.media.count - visual
        var media: CGFloat = 0
        if visual == 1 { media += 190 } else if visual > 1 { media += CGFloat((visual + 1) / 2) * 122 }
        media += CGFloat(files) * 64
        switch item.sender {
        case .system:
            return height + 28
        case .user, .member:
            let perLine = max(8, (min(width, 820) - 110) / 16)
            let lines = text.isEmpty ? 0 : text.split(separator: "\n", omittingEmptySubsequences: false)
                .reduce(0) { $0 + max(1, Int((CGFloat($1.count) / perLine).rounded(.up))) }
            if lines > 0 { height += CGFloat(lines) * 21 + 18 }
            if case .member = item.sender, row.showsSender { height += 20 }
            return height + media
        case .v:
            if row.showsSender { height += 24 }
            let perLine = max(8, (min(width, VTheme.bubbleMaxWidth + 76) - 104) / 16)
            let lines = text.isEmpty ? 1 : text.split(separator: "\n", omittingEmptySubsequences: false)
                .reduce(0) { $0 + max(1, Int((CGFloat($1.count) / perLine).rounded(.up))) }
            return height + min(1400, CGFloat(lines) * 24 + 40) + media
        }
    }
}

/// One message as a table row: the time above it when a while has passed, and
/// the distance to the row before it.
struct ChatRowView: View {
    let row: ChatListController.Row
    let sessionID: String
    let canReact: Bool

    var body: some View {
        VStack(spacing: 12) {
            if row.showsTime { TimeSeparator(date: row.item.time) }
            MessageRow(item: row.item, showsSender: row.showsSender, sessionID: sessionID, canReact: canReact)
                .equatable()
        }
        .padding(.top, row.showsTime ? 14 : row.showsSender ? 16 : 6)
        .padding(.horizontal, VTheme.pagePadding)
        .frame(maxWidth: 820)
        .frame(maxWidth: .infinity)
    }
}

/// Above the oldest message while there is more: older messages load as the
/// reader gets near, so this is a spinner, and a way to try again if that failed.
struct EarlierRow: View {
    let state: ChatListController.Earlier
    let retry: () -> Void

    var body: some View {
        Group {
            if state == .failed {
                Button("没有加载出来，点这里重试", action: retry)
                    .font(.footnote.weight(.medium))
                    .accessibilityIdentifier("earlierRetry")
            } else {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityLabel("正在加载更早的消息")
                    .accessibilityIdentifier("earlierLoading")
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 44)
    }
}

/// The composer with whatever V has to say about the connection above it.
struct ComposerBar: View {
    let sessionID: String
    @Bindable var draft: ChatDraft
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 6) {
            if let notice = model.notice {
                NoticeBanner(text: notice).transition(.move(edge: .bottom).combined(with: .opacity))
            } else if !model.status.isConnected, model.mode == .live {
                NoticeBanner(text: model.status.label, tone: .quiet)
            }
            Composer(
                text: $draft.text, quote: $draft.quote, attachments: $draft.attachments,
                isWorking: model.session(sessionID)?.isWorking ?? false,
                onSend: {
                    model.send(draft.text, quote: draft.quote, attachments: draft.attachments, in: sessionID)
                    draft.text = ""
                    draft.quote = nil
                    draft.attachments = []
                },
                onStop: { model.abort(sessionID) })
        }
        .frame(maxWidth: 820)
        .frame(maxWidth: .infinity)
        .animation(.snappy, value: model.notice)
        .onChange(of: draft.text) { _, text in model.drafts[sessionID] = text }
    }
}
